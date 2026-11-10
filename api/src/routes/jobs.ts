import { desc, eq } from 'drizzle-orm'
import { Hono } from 'hono'
import { z } from 'zod'
import { feedbackEvents, jobs } from '../../../db/schema'
import { db } from '../db'

const feedbackSchema = z.object({
  action: z.enum(['interested', 'pass', 'applied']),
  comment: z.string().optional(),
})

export const jobsRoute = new Hono()
  // listJobs(status?)：状态由最新一条反馈事件派生
  .get('/', async (c) => {
    const status = c.req.query('status')
    const allJobs = await db.select().from(jobs).orderBy(desc(jobs.collectedAt))
    const events = await db
      .select()
      .from(feedbackEvents)
      .orderBy(desc(feedbackEvents.createdAt))

    const latestByJob = new Map<string, (typeof events)[number]>()
    for (const e of events) {
      if (!latestByJob.has(e.jobId)) latestByJob.set(e.jobId, e)
    }

    let result = allJobs.map((job) => {
      const jobEvents = events.filter((e) => e.jobId === job.id)
      return {
        ...job,
        status: (latestByJob.get(job.id)?.action ?? 'new') as string,
        feedbackEvents: jobEvents,
      }
    })
    if (status) result = result.filter((j) => j.status === status)
    return c.json(result)
  })

  // getJob(id)
  .get('/:id', async (c) => {
    const id = c.req.param('id')
    const [job] = await db.select().from(jobs).where(eq(jobs.id, id))
    if (!job) return c.json({ error: 'job not found' }, 404)
    const events = await db
      .select()
      .from(feedbackEvents)
      .where(eq(feedbackEvents.jobId, id))
      .orderBy(desc(feedbackEvents.createdAt))
    return c.json({ ...job, status: events[0]?.action ?? 'new', feedbackEvents: events })
  })

  // addFeedback(jobId, action, comment?)：追加式，不改写历史
  .post('/:id/feedback', async (c) => {
    const id = c.req.param('id')
    const parsed = feedbackSchema.safeParse(await c.req.json())
    if (!parsed.success) return c.json({ error: parsed.error.issues }, 400)
    const [job] = await db.select({ id: jobs.id }).from(jobs).where(eq(jobs.id, id))
    if (!job) return c.json({ error: 'job not found' }, 404)
    const [event] = await db
      .insert(feedbackEvents)
      .values({
        jobId: id,
        action: parsed.data.action,
        comment: parsed.data.comment?.trim() ? parsed.data.comment.trim() : null,
      })
      .returning()
    return c.json(event, 201)
  })
