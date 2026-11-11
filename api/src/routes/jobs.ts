import { createHash } from 'node:crypto'
import { desc, eq } from 'drizzle-orm'
import { Hono } from 'hono'
import { z } from 'zod'
import { feedbackEvents, jobs } from '../../../db/schema'
import { db } from '../db'

const feedbackSchema = z.object({
  action: z.enum(['interested', 'pass', 'applied']),
  comment: z.string().optional(),
})

// M3：采集器入库字段（§5.2 映射），dedup_key 服务端统一计算 md5(source + source_url)
const ingestJobSchema = z.object({
  title: z.string().min(1),
  company: z.string().min(1),
  location: z.string().nullable().optional(),
  salaryMin: z.number().int().nullable().optional(),
  salaryMax: z.number().int().nullable().optional(),
  currency: z.string().default('CNY'),
  source: z.string().min(1),
  sourceUrl: z.string().min(1),
  description: z.string().default(''),
  postedAt: z.string().nullable().optional(),
})

const ingestSchema = z.object({
  jobs: z.array(ingestJobSchema).max(500),
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

  // M3 采集器入库：按 dedup_key 幂等 upsert（仅 compose 内网调用）
  .post('/ingest', async (c) => {
    const parsed = ingestSchema.safeParse(await c.req.json())
    if (!parsed.success) return c.json({ error: parsed.error.issues }, 400)
    const values = parsed.data.jobs.map((j) => ({
      ...j,
      location: j.location ?? null,
      salaryMin: j.salaryMin ?? null,
      salaryMax: j.salaryMax ?? null,
      postedAt: j.postedAt ?? null,
      dedupKey: createHash('md5').update(j.source + j.sourceUrl).digest('hex'),
    }))
    const inserted = await db
      .insert(jobs)
      .values(values)
      .onConflictDoNothing({ target: jobs.dedupKey })
      .returning({ id: jobs.id })
    return c.json({ inserted: inserted.length, skipped: values.length - inserted.length }, 201)
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
