import { createHash } from 'node:crypto'
import { desc, eq, inArray, sql } from 'drizzle-orm'
import { Hono } from 'hono'
import { z } from 'zod'
import { feedbackEvents, jobs, preferences } from '../../../db/schema'
import { db } from '../db'
import { buildScore, feedbackAdjustments, type JobRow, type Prefs } from '../scoring'

// M4：不合适必选六选一；感兴趣可选三选；applied 不带 reason
const PASS_REASONS = ['职能', '薪资', '地点', '职级', '公司', '其他'] as const
const INTERESTED_REASONS = ['职能对口', '薪资满意', '公司想去'] as const

const feedbackSchema = z.object({
  action: z.enum(['interested', 'pass', 'applied']),
  reason: z.string().max(20).optional(),
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
  // listJobs(status?, sort?)：状态由最新一条反馈事件派生；M4 起附可解释打分
  // sort=score（默认）：最终排序分降序、同分 posted_at 新→旧、30 天无反馈沉底
  // sort=time：采集时间倒序（全量）
  .get('/', async (c) => {
    const status = c.req.query('status')
    const sort = c.req.query('sort') ?? 'score'
    const allJobs = await db.select().from(jobs).orderBy(desc(jobs.collectedAt))
    const events = await db
      .select()
      .from(feedbackEvents)
      .orderBy(desc(feedbackEvents.createdAt))
    const [prefRow] = await db.select().from(preferences).limit(1)
    const prefs: Prefs = {
      roles: prefRow?.roles ?? [],
      locations: prefRow?.locations ?? [],
      salaryMin: prefRow?.salaryMin ?? null,
      keywordsInclude: prefRow?.keywordsInclude ?? [],
      keywordsExclude: prefRow?.keywordsExclude ?? [],
      experienceMin: prefRow?.experienceMin ?? null,
      backgroundText: prefRow?.backgroundText ?? null,
    }

    const latestByJob = new Map<string, (typeof events)[number]>()
    for (const e of events) {
      if (!latestByJob.has(e.jobId)) latestByJob.set(e.jobId, e)
    }

    const now = new Date()
    const adjustments = feedbackAdjustments(allJobs, events, prefs, now)
    let result = allJobs.map((job) => {
      const jobEvents = events.filter((e) => e.jobId === job.id)
      return {
        ...job,
        status: (latestByJob.get(job.id)?.action ?? 'new') as string,
        feedbackEvents: jobEvents,
        score: buildScore(job as JobRow, prefs, adjustments.get(job.id), now),
      }
    })
    if (status) result = result.filter((j) => j.status === status)
    if (sort === 'score') {
      const postedTime = (d: string | null) => (d ? new Date(d).getTime() : 0)
      const stale = (j: (typeof result)[number]) =>
        j.status === 'new' && now.getTime() - j.collectedAt.getTime() > 30 * 86400000
      result = [...result].sort((a, b) => {
        const sinkA = stale(a) ? 1 : 0
        const sinkB = stale(b) ? 1 : 0
        if (sinkA !== sinkB) return sinkA - sinkB // 30 天无反馈沉底
        if (b.score.final !== a.score.final) return b.score.final - a.score.final
        return postedTime(b.postedAt) - postedTime(a.postedAt)
      })
    }
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
  // §5.5：冲突时仅当已存在记录 description 为空且本次携带非空 JD → 仅更新 description（其余字段不动）
  .post('/ingest', async (c) => {
    const parsed = ingestSchema.safeParse(await c.req.json())
    if (!parsed.success) return c.json({ error: parsed.error.issues }, 400)
    const seen = new Set<string>()
    const values = parsed.data.jobs
      .map((j) => ({
        ...j,
        location: j.location ?? null,
        salaryMin: j.salaryMin ?? null,
        salaryMax: j.salaryMax ?? null,
        postedAt: j.postedAt ?? null,
        dedupKey: createHash('md5').update(j.source + j.sourceUrl).digest('hex'),
      }))
      .filter((v) => {
        if (seen.has(v.dedupKey)) return false
        seen.add(v.dedupKey)
        return true
      })
    if (!values.length) return c.json({ inserted: 0, updated: 0, skipped: 0 }, 201)
    // 确定性计数：先查出现有记录，算出「原 JD 为空且本次带非空 JD」的冲突行数 = updated
    const existing = await db
      .select({ dedupKey: jobs.dedupKey, description: jobs.description })
      .from(jobs)
      .where(
        inArray(
          jobs.dedupKey,
          values.map((v) => v.dedupKey),
        ),
      )
    const emptyDesc = new Set(existing.filter((e) => !e.description).map((e) => e.dedupKey))
    const willUpdate = values.filter((v) => emptyDesc.has(v.dedupKey) && v.description).length
    const rows = await db
      .insert(jobs)
      .values(values)
      .onConflictDoUpdate({
        target: jobs.dedupKey,
        set: { description: sql`excluded.description` },
        setWhere: sql`coalesce(${jobs.description}, '') = '' and excluded.description <> ''`,
      })
      .returning({ id: jobs.id })
    // 返回行 = 新插入 + 真实 update（setWhere 未生效的冲突行不返回），updated 取预算口径
    const updated = willUpdate
    const inserted = rows.length - updated
    return c.json({ inserted, updated, skipped: values.length - rows.length }, 201)
  })

  // addFeedback(jobId, action, reason?, comment?)：追加式，不改写历史
  .post('/:id/feedback', async (c) => {
    const id = c.req.param('id')
    const parsed = feedbackSchema.safeParse(await c.req.json())
    if (!parsed.success) return c.json({ error: parsed.error.issues }, 400)
    const { action, reason, comment } = parsed.data
    if (action === 'pass' && !(reason && PASS_REASONS.includes(reason as (typeof PASS_REASONS)[number]))) {
      return c.json({ error: '不合适必须选择原因（职能/薪资/地点/职级/公司/其他）' }, 400)
    }
    if (
      action === 'interested' &&
      reason &&
      !INTERESTED_REASONS.includes(reason as (typeof INTERESTED_REASONS)[number])
    ) {
      return c.json({ error: '感兴趣原因必须是：职能对口/薪资满意/公司想去' }, 400)
    }
    const [job] = await db.select({ id: jobs.id }).from(jobs).where(eq(jobs.id, id))
    if (!job) return c.json({ error: 'job not found' }, 404)
    const [event] = await db
      .insert(feedbackEvents)
      .values({
        jobId: id,
        action,
        reason: action === 'applied' ? null : (reason ?? null),
        comment: comment?.trim() ? comment.trim() : null,
      })
      .returning()
    return c.json(event, 201)
  })
