import { randomUUID } from 'node:crypto'
import { and, eq } from 'drizzle-orm'
import { z } from 'zod'
import {
  aiMessageSaves,
  conversations,
  interviewQuestions,
  materials,
  messages,
} from '../../../db/schema'
import { db } from '../db'

const materialInput = z.object({
  project: z.string().trim().min(1).max(100),
  title: z.string().trim().min(1).max(200),
  facets: z.array(z.string().trim().min(1).max(40)).max(10),
  capabilityL1: z.string().trim().max(40).nullable(),
  capabilityL2: z.string().trim().max(80).nullable(),
  metrics: z.string().trim().max(500).nullable(),
  content: z.string().trim().min(1).max(30000),
})

const questionInput = z.object({
  category: z.string().trim().min(1).max(40),
  question: z.string().trim().min(1).max(500),
  answerDraft: z.string().trim().min(1).max(30000),
  linkedMaterialId: z.string().uuid().nullable(),
})

const saveInputSchema = z.discriminatedUnion('targetType', [
  z.object({ targetType: z.literal('material'), data: materialInput }),
  z.object({ targetType: z.literal('question'), data: questionInput }),
])

type SaveInput = z.infer<typeof saveInputSchema>
type SourceRow = typeof aiMessageSaves.$inferSelect

function result(source: SourceRow, existing: boolean) {
  return {
    targetType: source.targetType as SaveInput['targetType'],
    targetId: source.targetId,
    existing,
    source: {
      sourceType: source.sourceType,
      conversationId: source.conversationId,
      messageId: source.messageId,
      provider: source.provider,
      model: source.model,
      savedAt: source.savedAt,
      targetType: source.targetType,
      targetId: source.targetId,
    },
  }
}

async function existingSave(messageId: string, targetType: SaveInput['targetType']) {
  const [source] = await db
    .select()
    .from(aiMessageSaves)
    .where(and(eq(aiMessageSaves.messageId, messageId), eq(aiMessageSaves.targetType, targetType)))
  return source ?? null
}

function isUniqueViolation(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false
  const value = error as { code?: string; cause?: { code?: string } }
  return value.code === '23505' || value.cause?.code === '23505'
}

export async function saveAIMessage(messageId: string, input: unknown) {
  const parsed = saveInputSchema.safeParse(input)
  if (!parsed.success) throw new Error('SAVE_INPUT_INVALID')
  const { targetType, data } = parsed.data
  const [row] = await db
    .select({ message: messages, conversation: conversations })
    .from(messages)
    .innerJoin(conversations, eq(messages.conversationId, conversations.id))
    .where(eq(messages.id, messageId))
  if (!row) throw new Error('AI_MESSAGE_NOT_FOUND')
  if (
    row.message.role !== 'assistant' ||
    row.message.status !== 'done' ||
    !row.message.content.trim()
  ) {
    throw new Error('AI_MESSAGE_NOT_SAVEABLE')
  }

  const existing = await existingSave(messageId, targetType)
  if (existing) return result(existing, true)

  try {
    return await db.transaction(async (tx) => {
      const targetId = randomUUID()
      if (targetType === 'material') {
        await tx.insert(materials).values({
          id: targetId,
          project: data.project,
          title: data.title,
          facets: data.facets,
          capabilityL1: data.capabilityL1 || null,
          capabilityL2: data.capabilityL2 || null,
          metrics: data.metrics || null,
          content: data.content,
          tags: [],
          attachments: [],
          others: null,
        })
      } else {
        await tx.insert(interviewQuestions).values({
          id: targetId,
          category: data.category,
          question: data.question,
          answerDraft: data.answerDraft,
          linkedMaterialId: data.linkedMaterialId,
          confidence: null,
        })
      }
      const [source] = await tx.insert(aiMessageSaves).values({
        sourceType: 'ai_message',
        conversationId: row.conversation.id,
        messageId,
        provider: row.conversation.provider,
        model: row.conversation.model,
        targetType,
        targetId,
      }).returning()
      return result(source, false)
    })
  } catch (error) {
    if (isUniqueViolation(error)) {
      const duplicate = await existingSave(messageId, targetType)
      if (duplicate) return result(duplicate, true)
    }
    throw error
  }
}
