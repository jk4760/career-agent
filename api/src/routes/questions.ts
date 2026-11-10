import { desc, eq } from 'drizzle-orm'
import { Hono } from 'hono'
import { z } from 'zod'
import { interviewQuestions } from '../../../db/schema'
import { db } from '../db'

const questionSchema = z.object({
  id: z.string().uuid(),
  category: z.string().nullable(),
  question: z.string().min(1),
  answerDraft: z.string().nullable(),
  linkedMaterialId: z.string().uuid().nullable(),
  confidence: z.number().int().min(1).max(5).nullable(),
  updatedAt: z.string(),
})

export const questionsRoute = new Hono()
  // listQuestions()
  .get('/', async (c) => {
    const rows = await db
      .select()
      .from(interviewQuestions)
      .orderBy(desc(interviewQuestions.updatedAt))
    return c.json(rows)
  })

  // saveQuestion(q)：按 id upsert
  .post('/', async (c) => {
    const parsed = questionSchema.safeParse(await c.req.json())
    if (!parsed.success) return c.json({ error: parsed.error.issues }, 400)
    const q = parsed.data
    const [saved] = await db
      .insert(interviewQuestions)
      .values({ ...q, updatedAt: new Date() })
      .onConflictDoUpdate({
        target: interviewQuestions.id,
        set: {
          category: q.category,
          question: q.question,
          answerDraft: q.answerDraft,
          linkedMaterialId: q.linkedMaterialId,
          confidence: q.confidence,
          updatedAt: new Date(),
        },
      })
      .returning()
    return c.json(saved)
  })

  // deleteQuestion(id)
  .delete('/:id', async (c) => {
    await db.delete(interviewQuestions).where(eq(interviewQuestions.id, c.req.param('id')))
    return c.json({ ok: true })
  })
