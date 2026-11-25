import { randomUUID } from 'node:crypto'
import { desc, eq } from 'drizzle-orm'
import { conversations, messages } from '../../../db/schema'
import { db } from '../db'
import {
  markModelCallRunning,
  releaseModelCall,
  reserveModelCall,
  settleModelCall,
  usageFromOpenAI,
} from './budget'
import {
  assembleContext,
  CONTEXT_LIMITS,
  ContextError,
  defaultContextSelection,
  normalizeContextSelection,
  type ContextSelection,
} from './context'
import { estimateTokens } from './pricing'
import {
  assertCatalogEntryUsable,
  catalogEntry,
  catalogEntryForConversation,
} from './modelCatalog'

const UPSTREAM_TIMEOUT_MS = 120_000

type ProviderMessage = {
  role: string
  content: string
  reasoning_content?: string
  [key: string]: unknown
}

interface ChatInput {
  conversationId?: string
  content: string
  clientRequestId: string
  contextSelection?: unknown
}

let activeGeneration: { messageId: string; controller: AbortController } | null = null

function sse(event: string, data: unknown): Uint8Array {
  return new TextEncoder().encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
}

function errorCode(error: unknown): string {
  if (error instanceof Error && 'code' in error) return String(error.code)
  return 'UPSTREAM_ERROR'
}

export async function createConversation(catalogId?: string) {
  const entry = catalogEntry(catalogId)
  if (!entry) throw new Error('MODEL_NOT_AVAILABLE')
  assertCatalogEntryUsable(entry)
  const selection = await defaultContextSelection()
  const [conversation] = await db
    .insert(conversations)
    .values({
      provider: entry.provider,
      model: entry.model,
      contextSelection: selection,
    })
    .returning()
  return conversation
}

async function conversationMessages(conversationId: string) {
  return db
    .select()
    .from(messages)
    .where(eq(messages.conversationId, conversationId))
    .orderBy(messages.createdAt)
}

export async function conversationDetails(conversationId: string) {
  const [conversation] = await db.select().from(conversations).where(eq(conversations.id, conversationId))
  if (!conversation) return null
  return {
    ...conversation,
    messages: (await conversationMessages(conversationId)).map((message) => {
      const { providerMessage: _providerMessage, ...safeMessage } = message
      return safeMessage
    }),
  }
}

export async function updateConversationContext(conversationId: string, input: unknown) {
  const [conversation] = await db.select().from(conversations).where(eq(conversations.id, conversationId))
  if (!conversation) return null
  const selection = normalizeContextSelection(
    input,
    conversation.contextSelection as ContextSelection,
  )
  const context = await assembleContext(selection)
  const [updated] = await db
    .update(conversations)
    .set({ contextSelection: selection, updatedAt: new Date() })
    .where(eq(conversations.id, conversationId))
    .returning()
  return { conversation: updated, estimate: context }
}

export async function estimateConversationContext(input: unknown) {
  const selection = normalizeContextSelection(input, await defaultContextSelection())
  return assembleContext(selection, false)
}

export function stopChat(messageId: string): boolean {
  if (activeGeneration?.messageId !== messageId) return false
  activeGeneration.controller.abort()
  return true
}

export async function historyForRequest(conversationId: string): Promise<ProviderMessage[]> {
  const rows = await db
    .select()
    .from(messages)
    .where(eq(messages.conversationId, conversationId))
    .orderBy(desc(messages.createdAt))
    .limit(CONTEXT_LIMITS.historyRounds * 2)
  return rows.reverse().flatMap((row) => {
    if (row.role === 'assistant' && row.providerMessage) {
      return [row.providerMessage as ProviderMessage]
    }
    return [{ role: row.role, content: row.content }]
  })
}

export async function createChatStream(input: ChatInput, downstreamSignal?: AbortSignal) {
  const content = input.content.trim()
  if (!content) throw new ContextError('请输入问题')
  if (content.length > CONTEXT_LIMITS.questionChars) throw new ContextError('单次问题最多 4,000 字')
  if (!input.clientRequestId) throw new ContextError('缺少 client_request_id')

  const [duplicate] = await db
    .select()
    .from(messages)
    .where(eq(messages.clientRequestId, input.clientRequestId))
  if (duplicate) {
    if (duplicate.status === 'streaming') throw new ContextError('相同请求正在生成中')
    return {
      duplicate: true,
      conversationId: duplicate.conversationId,
      assistantMessageId: duplicate.id,
      content: duplicate.content,
      status: duplicate.status,
    }
  }

  let conversationId = input.conversationId ?? null
  let conversation: typeof conversations.$inferSelect | undefined
  if (conversationId) {
    ;[conversation] = await db.select().from(conversations).where(eq(conversations.id, conversationId))
    if (!conversation) throw new ContextError('会话不存在')
  } else {
    conversation = await createConversation()
    conversationId = conversation.id
  }
  const modelConfig = catalogEntryForConversation(conversation.provider, conversation.model)
  if (!modelConfig) throw new Error('MODEL_NOT_AVAILABLE')
  assertCatalogEntryUsable(modelConfig)
  const selection = input.contextSelection
    ? normalizeContextSelection(input.contextSelection, conversation.contextSelection as ContextSelection)
    : (conversation.contextSelection as ContextSelection)
  const context = await assembleContext(selection)
  const history = await historyForRequest(conversationId)
  const fullInput = `${context.prompt}\n\n【历史消息】\n${JSON.stringify(history)}\n\n【本次问题】\n${content}`
  if (fullInput.length > CONTEXT_LIMITS.totalChars) {
    throw new ContextError('上下文与本次问题合计超过 24,000 字，请减少资料或缩短历史')
  }

  const [userMessage] = await db
    .insert(messages)
    .values({ conversationId, role: 'user', content, status: 'done' })
    .returning()
  const [assistantMessage] = await db
    .insert(messages)
    .values({
      conversationId,
      role: 'assistant',
      content: '',
      status: 'streaming',
      clientRequestId: input.clientRequestId,
      contextSnapshot: context.snapshot,
    })
    .returning()

  const controller = new AbortController()
  if (downstreamSignal) {
    if (downstreamSignal.aborted) controller.abort()
    downstreamSignal.addEventListener('abort', () => controller.abort(), { once: true })
  }

  const stream = new ReadableStream<Uint8Array>({
    start(streamController) {
      streamController.enqueue(
        sse('meta', {
          conversationId,
          userMessageId: userMessage.id,
          assistantMessageId: assistantMessage.id,
          clientRequestId: input.clientRequestId,
        }),
      )
      void (async () => {
        let answer = ''
        let reasoning = ''
        let usage: ReturnType<typeof usageFromOpenAI> = null
        let finishReason: string | null = null
        let reservationId: string | null = null
        let sent = false
        let finalStatus = 'done'
        let finalError: string | null = null
        try {
          if (activeGeneration) throw new ContextError('已有生成任务进行中，请先停止')
          activeGeneration = { messageId: assistantMessage.id, controller }
          const providerMessages: ProviderMessage[] = [
            {
              role: 'system',
              content:
                '你是 NextCareer 的求职 AI 助手。只依据提供的个人资料与岗位信息回答；缺少证据时明确说明，不编造经历或成果。',
            },
            ...(context.prompt
              ? [{ role: 'user', content: `以下是本次明确选择的资料：\n\n${context.prompt}` }]
              : []),
            ...history,
            { role: 'user', content },
          ]
          const reservation = await reserveModelCall({
            purpose: 'chat',
            provider: conversation.provider,
            model: conversation.model,
            estimatedInputTokens: estimateTokens(JSON.stringify(providerMessages)),
            maxCompletionTokens: modelConfig.maxCompletionTokens,
            businessId: assistantMessage.id,
            requestId: randomUUID(),
          })
          reservationId = reservation.requestId
          const apiKey = process.env[modelConfig.apiKeyEnv]
          if (!apiKey) {
            await releaseModelCall(reservation.requestId)
            throw new ContextError('模型服务未配置')
          }
          await markModelCallRunning(reservation.requestId)
          sent = true
          const resp = await fetch(`${modelConfig.baseUrl}/chat/completions`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${apiKey}`,
            },
            body: JSON.stringify({
              model: conversation.model,
              ...(modelConfig.capabilities.reasoning ? { reasoning_effort: 'low' } : {}),
              max_completion_tokens: modelConfig.maxCompletionTokens,
              stream: true,
              messages: providerMessages,
            }),
            signal: AbortSignal.any([controller.signal, AbortSignal.timeout(UPSTREAM_TIMEOUT_MS)]),
          })
          if (!resp.ok) {
            await resp.text()
            throw new Error(`HTTP_${resp.status}`)
          }
          if (!resp.body) throw new Error('UPSTREAM_EMPTY_STREAM')
          const reader = resp.body.getReader()
          const decoder = new TextDecoder()
          let buffer = ''
          while (true) {
            const { done, value } = await reader.read()
            buffer += decoder.decode(value, { stream: !done })
            let boundary = buffer.indexOf('\n\n')
            while (boundary >= 0) {
              const packet = buffer.slice(0, boundary)
              buffer = buffer.slice(boundary + 2)
              boundary = buffer.indexOf('\n\n')
              for (const line of packet.split('\n')) {
                if (!line.startsWith('data:')) continue
                const raw = line.slice(5).trim()
                if (!raw || raw === '[DONE]') continue
                let chunk: {
                  choices?: {
                    delta?: { content?: string; reasoning_content?: string }
                    message?: ProviderMessage
                    finish_reason?: string | null
                  }[]
                  usage?: unknown
                }
                try {
                  chunk = JSON.parse(raw) as typeof chunk
                } catch {
                  continue
                }
                if (chunk.usage) usage = usageFromOpenAI(chunk)
                const choice = chunk.choices?.[0]
                if (choice?.delta?.reasoning_content) reasoning += choice.delta.reasoning_content
                if (choice?.delta?.content) {
                  answer += choice.delta.content
                  streamController.enqueue(sse('delta', { content: choice.delta.content }))
                }
                if (choice?.finish_reason) finishReason = choice.finish_reason
              }
            }
            if (done) break
          }
          if (controller.signal.aborted) finalStatus = 'stopped'
          else if (finishReason === 'length') finalStatus = 'truncated'
          streamController.enqueue(sse('done', { status: finalStatus, usage }))
        } catch (error) {
          finalStatus = controller.signal.aborted ? 'stopped' : 'error'
          finalError = errorCode(error)
          if (finalStatus === 'stopped') streamController.enqueue(sse('done', { status: 'stopped' }))
          else streamController.enqueue(sse('error', { code: finalError }))
        } finally {
          if (reservationId) {
            await settleModelCall({
              requestId: reservationId,
              usage,
              failed: finalStatus === 'error',
              errorCode: finalError ?? undefined,
            })
          }
          const providerMessage: ProviderMessage = {
            role: 'assistant',
            content: answer,
          }
          if (reasoning) providerMessage.reasoning_content = reasoning
          await db
            .update(messages)
            .set({
              content: answer,
              status: finalStatus,
              providerMessage,
              usageRequestId: reservationId,
              errorCode: finalError,
              completedAt: new Date(),
            })
            .where(eq(messages.id, assistantMessage.id))
          await db
            .update(conversations)
            .set({ updatedAt: new Date() })
            .where(eq(conversations.id, conversationId))
          if (activeGeneration?.messageId === assistantMessage.id) activeGeneration = null
          streamController.close()
        }
      })().catch(async () => {
        streamController.close()
      })
    },
    cancel() {
      controller.abort()
    },
  })

  return {
    duplicate: false,
    conversationId,
    assistantMessageId: assistantMessage.id,
    stream,
  }
}
