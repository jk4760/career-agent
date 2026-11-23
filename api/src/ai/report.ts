import { randomUUID } from 'node:crypto'
import { and, desc, eq, isNull, sql } from 'drizzle-orm'
import { z } from 'zod'
import {
  feedbackEvents,
  jobs,
  reportPushLog,
  reportSourceSnapshots,
  resumeStrategyReports,
  resumeStrategySettings,
} from '../../../db/schema'
import { db } from '../db'
import {
  markModelCallRunning,
  reserveModelCall,
  settleModelCall,
  usageFromOpenAI,
} from './budget'
import {
  assembleContext,
  defaultContextSelection,
  hashContent,
  normalizeContextSelection,
  type ContextSelection,
} from './context'
import { estimateTokens } from './pricing'
import { getBudgetStatus } from './budget'

const MAX_COMPLETION_TOKENS = 4000
const REPORT_DAILY_LIMIT = 3

const reportSchema = z.object({
  resume_count: z.number().int().min(1).max(3),
  overview: z.string().min(1),
  sample_warning: z.string().optional(),
  directions: z.array(z.object({
    name: z.string().min(1),
    summary: z.string().min(1),
    key_capabilities: z.array(z.string().min(1)).min(2).max(3),
    priority_experiences: z.array(z.object({
      title: z.string(),
      reason: z.string(),
      source_type: z.enum(['resume', 'material']),
      source_id: z.string().uuid(),
    })),
    evidence: z.array(z.object({
      text: z.string(),
      source_type: z.enum(['resume', 'material']),
      source_id: z.string().uuid(),
    })),
    gaps: z.array(z.string()),
  })).min(1).max(3),
  source_summary: z.object({
    interested_job_count: z.number().int().nonnegative(),
    resume_id: z.string().uuid(),
    resume_name: z.string(),
    material_ids: z.array(z.string().uuid()),
    material_count: z.number().int().nonnegative(),
  }),
})

export type ResumeStrategyReport = z.infer<typeof reportSchema>

type SourceRecord = {
  sourceType: 'resume' | 'material' | 'job'
  sourceId: string
  name: string
  version: string
  hash: string
  content: string
}

function reportEnabled() {
  return process.env.RESUME_STRATEGY_ENABLED?.trim().toLowerCase() === 'true'
}

async function activeInterestedJobs() {
  const events = await db
    .select()
    .from(feedbackEvents)
    .where(isNull(feedbackEvents.canceledAt))
    .orderBy(desc(feedbackEvents.createdAt))
  const latest = new Map<string, string>()
  for (const event of events) if (!latest.has(event.jobId)) latest.set(event.jobId, event.action)
  const ids = [...latest].filter(([, action]) => action === 'interested').map(([id]) => id)
  if (!ids.length) return []
  const rows = await db.select().from(jobs)
  return rows.filter((job) => ids.includes(job.id))
}

async function selectionForReports(): Promise<ContextSelection> {
  const [settings] = await db.select().from(resumeStrategySettings).limit(1)
  if (settings) return settings.selection as ContextSelection
  const [latest] = await db
    .select()
    .from(resumeStrategyReports)
    .where(eq(resumeStrategyReports.status, 'done'))
    .orderBy(desc(resumeStrategyReports.version))
    .limit(1)
  if (latest) return latest.selection as ContextSelection
  return defaultContextSelection()
}

async function collectSources(selection: ContextSelection): Promise<SourceRecord[]> {
  const context = await assembleContext(selection)
  const sources: SourceRecord[] = context.segments.flatMap((item) =>
    item.sourceType === 'resume' || item.sourceType === 'material'
      ? [{
          sourceType: item.sourceType,
          sourceId: item.sourceId,
          name: item.name,
          version: item.version,
          hash: item.hash,
          content: item.content,
        }]
      : [],
  )
  const interested = await activeInterestedJobs()
  for (const job of interested) {
    const full = `${job.company} · ${job.title}\n${job.description ?? ''}`
    sources.push({
      sourceType: 'job',
      sourceId: job.id,
      name: `${job.company} · ${job.title}`,
      version: job.collectedAt.toISOString(),
      hash: hashContent(full),
      content: [
        `${job.company} · ${job.title}`,
        `地点：${job.location ?? '未知'}`,
        `薪资：${job.salaryMin ?? '未知'}-${job.salaryMax ?? '未知'}`,
        (job.description ?? '').slice(0, 1200),
      ].join('\n'),
    })
  }
  return sources
}

function inputHash(selection: ContextSelection, sources: SourceRecord[]): string {
  return hashContent(JSON.stringify({
    selection: {
      includePreferences: selection.includePreferences,
      resumeId: selection.resumeId,
      materialIds: [...selection.materialIds].sort(),
      jobIds: [...selection.jobIds].sort(),
    },
    sources: sources.map((source) => ({
      type: source.sourceType,
      id: source.sourceId,
      version: source.version,
      hash: source.hash,
    })).sort((a, b) => `${a.type}:${a.id}`.localeCompare(`${b.type}:${b.id}`)),
  }))
}

function jobDiff(current: SourceRecord[], previous: SourceRecord[]) {
  const currentJobs = current.filter((source) => source.sourceType === 'job')
  const previousJobs = previous.filter((source) => source.sourceType === 'job')
  const currentMap = new Map(currentJobs.map((source) => [source.sourceId, source]))
  const previousMap = new Map(previousJobs.map((source) => [source.sourceId, source]))
  return {
    added_job_ids: [...currentMap.keys()].filter((id) => !previousMap.has(id)),
    removed_job_ids: [...previousMap.keys()].filter((id) => !currentMap.has(id)),
    changed_job_ids: [...currentMap.keys()].filter((id) => previousMap.get(id)?.hash !== currentMap.get(id)?.hash && previousMap.has(id)),
  }
}

async function snapshotsForReport(reportId: string): Promise<SourceRecord[]> {
  const rows = await db
    .select()
    .from(reportSourceSnapshots)
    .where(eq(reportSourceSnapshots.reportId, reportId))
  return rows.map((row) => ({
    sourceType: row.sourceType as SourceRecord['sourceType'],
    sourceId: row.sourceId,
    name: '',
    version: row.version,
    hash: row.hash,
    content: row.content,
  }))
}

async function currentReport() {
  const [report] = await db
    .select()
    .from(resumeStrategyReports)
    .where(eq(resumeStrategyReports.status, 'done'))
    .orderBy(desc(resumeStrategyReports.version))
    .limit(1)
  return report ?? null
}

export async function reportState() {
  const selection = await selectionForReports()
  const sources = await collectSources(selection)
  const current = await currentReport()
  const currentSources = current ? await snapshotsForReport(current.id) : []
  const diff = jobDiff(sources, currentSources)
  const hash = inputHash(selection, sources)
  const contextChanged = Boolean(current && current.inputHash !== hash)
  const [generating] = await db
    .select()
    .from(resumeStrategyReports)
    .where(eq(resumeStrategyReports.status, 'generating'))
    .orderBy(desc(resumeStrategyReports.createdAt))
    .limit(1)
  const all = await db.select().from(resumeStrategyReports)
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai' }).format(new Date())
  const usedToday = all.filter((report) =>
    new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai' }).format(report.createdAt) === today,
  ).length
  const interestedCount = sources.filter((source) => source.sourceType === 'job').length
  const latestTask = [...all].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0] ?? null
  return {
    enabled: reportEnabled(),
    current,
    generating: generating ?? null,
    latestTask,
    selection,
    interestedCount,
    resumeAvailable: sources.some((source) => source.sourceType === 'resume' && source.content.trim()),
    materialCount: selection.materialIds.length,
    diff,
    inputHash: hash,
    stale: contextChanged,
    noChange: Boolean(current && current.inputHash === hash),
    dailyUsed: usedToday,
    dailyLimit: REPORT_DAILY_LIMIT,
    budget: await getBudgetStatus(),
  }
}

export async function saveReportSelection(input: unknown) {
  const selection = normalizeContextSelection(input, await selectionForReports())
  await assembleContext(selection)
  const existing = await db.select().from(resumeStrategySettings).limit(1)
  if (existing.length) {
    await db
      .update(resumeStrategySettings)
      .set({ selection, updatedAt: new Date() })
      .where(eq(resumeStrategySettings.id, existing[0].id))
  } else {
    await db.insert(resumeStrategySettings).values({ selection })
  }
  return reportState()
}

const activeReports = new Map<string, AbortController>()

export function cancelReport(id: string): boolean {
  const controller = activeReports.get(id)
  if (!controller) return false
  controller.abort()
  return true
}

function reportJsonSchema() {
  return {
    type: 'object',
    additionalProperties: false,
    required: ['resume_count', 'overview', 'directions', 'source_summary'],
    properties: {
      resume_count: { type: 'integer', minimum: 1, maximum: 3 },
      overview: { type: 'string' },
      sample_warning: { type: 'string' },
      directions: {
        type: 'array', minItems: 1, maxItems: 3,
        items: {
          type: 'object', additionalProperties: false,
          required: ['name', 'summary', 'key_capabilities', 'priority_experiences', 'evidence', 'gaps'],
          properties: {
            name: { type: 'string' }, summary: { type: 'string' },
            key_capabilities: { type: 'array', minItems: 2, maxItems: 3, items: { type: 'string' } },
            priority_experiences: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['title', 'reason', 'source_type', 'source_id'], properties: { title: { type: 'string' }, reason: { type: 'string' }, source_type: { type: 'string', enum: ['resume', 'material'] }, source_id: { type: 'string' } } } },
            evidence: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['text', 'source_type', 'source_id'], properties: { text: { type: 'string' }, source_type: { type: 'string', enum: ['resume', 'material'] }, source_id: { type: 'string' } } } },
            gaps: { type: 'array', items: { type: 'string' } },
          },
        },
      },
      source_summary: { type: 'object', additionalProperties: false, required: ['interested_job_count', 'resume_id', 'resume_name', 'material_ids', 'material_count'], properties: { interested_job_count: { type: 'integer' }, resume_id: { type: 'string' }, resume_name: { type: 'string' }, material_ids: { type: 'array', items: { type: 'string' } }, material_count: { type: 'integer' } } },
    },
  }
}

function validateReport(value: unknown, sources: SourceRecord[]): ResumeStrategyReport {
  const report = reportSchema.parse(value)
  const sourceMap = new Map(sources.map((source) => [source.sourceId, source]))
  for (const direction of report.directions) {
    for (const reference of [...direction.priority_experiences, ...direction.evidence]) {
      if (!sourceMap.has(reference.source_id)) throw new Error('REPORT_SOURCE_INVALID')
    }
    direction.evidence = direction.evidence.filter((evidence) => {
      const source = sourceMap.get(evidence.source_id)
      return source?.content.includes(evidence.text) ?? false
    })
  }
  return report
}

async function runReport(id: string) {
  const controller = new AbortController()
  activeReports.set(id, controller)
  const [task] = await db.select().from(resumeStrategyReports).where(eq(resumeStrategyReports.id, id))
  if (!task) {
    activeReports.delete(id)
    return
  }
  let reservationId: string | null = null
  let usage: ReturnType<typeof usageFromOpenAI> = null
  let status = 'done'
  let errorCode: string | null = null
  try {
    const selection = task.selection as ContextSelection
    const sources = await collectSources(selection)
    const previous = task.generationMode === 'rebuild' ? [] : await db
      .select()
      .from(resumeStrategyReports)
      .where(and(eq(resumeStrategyReports.status, 'done'), sql`${resumeStrategyReports.version} < ${task.version}`))
      .orderBy(desc(resumeStrategyReports.version))
      .limit(1)
    const previousSources = previous[0] ? await snapshotsForReport(previous[0].id) : []
    const diff = jobDiff(sources, previousSources)
    const prompt = {
      previous_report: previous[0]?.report ?? null,
      current_sources: sources,
      added_or_changed_job_ids: [...diff.added_job_ids, ...diff.changed_job_ids],
      removed_job_ids: diff.removed_job_ids,
    }
    const reservation = await reserveModelCall({
      purpose: 'resume_strategy', provider: 'moonshot', model: task.model,
      estimatedInputTokens: estimateTokens(JSON.stringify(prompt)), maxCompletionTokens: MAX_COMPLETION_TOKENS,
      businessId: id, requestId: randomUUID(),
    })
    reservationId = reservation.requestId
    const apiKey = process.env.MOONSHOT_API_KEY
    if (!apiKey) throw new Error('MODEL_NOT_CONFIGURED')
    await markModelCallRunning(reservationId)
    const baseUrl = process.env.MOONSHOT_BASE_URL || 'https://api.moonshot.cn/v1'
    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: task.model, reasoning_effort: 'low', max_completion_tokens: MAX_COMPLETION_TOKENS,
        response_format: { type: 'json_schema', json_schema: { name: 'resume_strategy', strict: true, schema: reportJsonSchema() } },
        messages: [
          { role: 'system', content: '根据岗位需求与个人真实资料规划 1–3 个方向性简历。每个方向给 2–3 个具体能力重点。证据原文必须逐字来自输入，禁止编造经历、数字或成果。返回完整结构化 JSON。' },
          { role: 'user', content: JSON.stringify(prompt) },
        ],
      }),
      signal: AbortSignal.any([controller.signal, AbortSignal.timeout(120_000)]),
    })
    const bodyText = await response.text()
    let payload: { choices?: { message?: { content?: string }; finish_reason?: string }[]; usage?: unknown }
    try { payload = JSON.parse(bodyText) as typeof payload } catch { payload = {} }
    usage = usageFromOpenAI(payload)
    if (!response.ok) throw new Error(`HTTP_${response.status}`)
    if (payload.choices?.[0]?.finish_reason === 'length') {
      status = 'truncated'
      errorCode = 'TRUNCATED'
    } else {
      const parsed = JSON.parse(payload.choices?.[0]?.message?.content ?? '')
      const report = validateReport(parsed, sources)
      await db.update(resumeStrategyReports).set({ report }).where(eq(resumeStrategyReports.id, id))
    }
  } catch (error) {
    status = controller.signal.aborted ? 'canceled' : 'error'
    errorCode = controller.signal.aborted ? 'CANCELED' : error instanceof Error ? error.message.slice(0, 100) : 'REPORT_ERROR'
  } finally {
    if (reservationId) {
      await settleModelCall({ requestId: reservationId, usage, failed: status !== 'done', errorCode: errorCode ?? undefined })
    }
    await db.update(resumeStrategyReports).set({ status, errorCode, usageRequestId: reservationId, completedAt: new Date() }).where(eq(resumeStrategyReports.id, id))
    activeReports.delete(id)
  }

  if (status === 'done') {
    const [finished] = await db.select().from(resumeStrategyReports).where(eq(resumeStrategyReports.id, id))
    if (process.env.RESUME_STRATEGY_FEISHU_PUSH_ENABLED === 'true') {
      const { buildReportSummaryCard } = await import('../feishu/reportCard')
      const { sendAppCard } = await import('../feishu/sender')
      const result = await sendAppCard(process.env.FEISHU_CHAT_ID ?? '', buildReportSummaryCard(finished, await reportState()))
      if (result.ok) await db.insert(reportPushLog).values({ reportId: id, mode: 'update', inputHash: finished.inputHash })
    }
  } else if (status === 'error') {
    const { sendAlert } = await import('../push')
    await sendAlert(`简历方向报告生成失败（${errorCode ?? 'REPORT_ERROR'}），上一份成功报告不受影响`)
  }
}

async function generateReportAtomic(input?: { selection?: unknown; mode?: 'initial' | 'update' | 'rebuild' }) {
  if (!reportEnabled()) throw new Error('FEATURE_DISABLED')
  const mode = input?.mode ?? 'update'
  const selection = input?.selection
    ? normalizeContextSelection(input.selection, await selectionForReports())
    : await selectionForReports()
  await saveReportSelection(selection)
  const sources = await collectSources(selection)
  const interested = sources.filter((source) => source.sourceType === 'job')
  const resume = sources.find((source) => source.sourceType === 'resume')
  if (!interested.length) throw new Error('NO_INTERESTED_JOBS')
  if (!resume?.content.trim()) throw new Error('RESUME_REQUIRED')
  const hash = inputHash(selection, sources)
  const current = await currentReport()
  if (mode !== 'rebuild' && current?.inputHash === hash) return { noChange: true, report: current }
  const [generating] = await db.select().from(resumeStrategyReports).where(eq(resumeStrategyReports.status, 'generating')).limit(1)
  if (generating) {
    if (generating.inputHash === hash) return { noChange: false, report: generating }
    throw new Error('REPORT_BUSY')
  }
  const state = await reportState()
  if (state.dailyUsed >= REPORT_DAILY_LIMIT) throw new Error('REPORT_DAILY_LIMIT')
  if (state.budget.exhausted) throw new Error('BUDGET_EXCEEDED')
  const versions = await db.select({ version: resumeStrategyReports.version }).from(resumeStrategyReports)
  const version = Math.max(0, ...versions.map((item) => item.version)) + 1
  const [task] = await db.insert(resumeStrategyReports).values({
    version, status: 'generating', generationMode: mode, inputHash: hash, selection,
    sourceJobIds: interested.map((job) => job.sourceId),
    model: process.env.MOONSHOT_MODEL || 'kimi-k3.1-pro',
  }).returning()
  await db.insert(reportSourceSnapshots).values(sources.map((source) => ({
    reportId: task.id, sourceType: source.sourceType, sourceId: source.sourceId,
    version: source.version, hash: source.hash, content: source.content,
  })))
  void runReport(task.id)
  return { noChange: false, report: task }
}

let reportGenerationQueue: Promise<void> = Promise.resolve()

export function generateReport(input?: { selection?: unknown; mode?: 'initial' | 'update' | 'rebuild' }) {
  const result = reportGenerationQueue.then(() => generateReportAtomic(input))
  reportGenerationQueue = result.then(
    () => undefined,
    () => undefined,
  )
  return result
}

export async function reportHistory() {
  return db.select({
    id: resumeStrategyReports.id, version: resumeStrategyReports.version, status: resumeStrategyReports.status,
    report: resumeStrategyReports.report, inputHash: resumeStrategyReports.inputHash,
    selection: resumeStrategyReports.selection, sourceJobIds: resumeStrategyReports.sourceJobIds,
    model: resumeStrategyReports.model, errorCode: resumeStrategyReports.errorCode,
    createdAt: resumeStrategyReports.createdAt, completedAt: resumeStrategyReports.completedAt,
  }).from(resumeStrategyReports).orderBy(desc(resumeStrategyReports.version))
}

export async function reportSnapshots(reportId: string) {
  const [report] = await db.select().from(resumeStrategyReports).where(eq(resumeStrategyReports.id, reportId))
  if (!report) return null
  const snapshots = await db.select().from(reportSourceSnapshots).where(eq(reportSourceSnapshots.reportId, reportId))
  return { report, snapshots }
}
