// M4 施工项 4：飞书推送（§3.4 规格）+ 同群 ⚠️ 告警
// 选择逻辑：新岗（未推过且最终分≥60，近 7 天入库）+ 重推岗（首推满 5 天无任何反馈，
// 生命周期最多 2 次）合并 Top 15，最终分降序、同分 posted_at 新→旧；静默不推；
// push_log 岗位级记录，仅推送成功后写入（失败重试天然同批，at-least-once）
import { createHmac } from 'node:crypto'
import { desc } from 'drizzle-orm'
import { feedbackEvents, jobs, pushLog } from '../../db/schema'
import { db } from './db'
import { buildScore, feedbackAdjustments, type JobRow, type Prefs, type ScoreBreakdown } from './scoring'

const PUSH_THRESHOLD = 60 // §3.6-18：LLM 分分布第一周观察后校准
const TOP_N = 15
const NEW_JOB_WINDOW_DAYS = 7 // 「日水位以来入库」的操作化边界（未推过才是真条件）
const REPUSH_AFTER_DAYS = 5

const WEBHOOK_URL = () => process.env.FEISHU_WEBHOOK_URL ?? ''
const WEBHOOK_SECRET = () => process.env.FEISHU_WEBHOOK_SECRET ?? ''

// 飞书自定义机器人签名：string_to_sign = timestamp\nsecret，以其为 key 对空串做 HMAC-SHA256
function feishuSign(timestamp: number, secret: string): string {
  const stringToSign = `${timestamp}\n${secret}`
  return createHmac('sha256', stringToSign).update('').digest('base64')
}

async function feishuSend(payload: unknown): Promise<{ ok: boolean; detail: string }> {
  const url = WEBHOOK_URL()
  if (!url) return { ok: false, detail: 'FEISHU_WEBHOOK_URL 未配置' }
  const body: Record<string, unknown> = payload as Record<string, unknown>
  const secret = WEBHOOK_SECRET()
  if (secret) {
    const timestamp = Math.floor(Date.now() / 1000)
    body.timestamp = String(timestamp)
    body.sign = feishuSign(timestamp, secret)
  }
  try {
    const resp = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(15_000),
    })
    const data = (await resp.json()) as { code?: number; msg?: string }
    if (!resp.ok || (data.code ?? 0) !== 0) {
      return { ok: false, detail: `HTTP ${resp.status} code=${data.code} msg=${data.msg}` }
    }
    return { ok: true, detail: 'ok' }
  } catch (e) {
    return { ok: false, detail: e instanceof Error ? e.message : String(e) }
  }
}

/** ⚠️ 告警：推送/采集/评分任一步失败时同群发一条（供 ops 脚本与推送模块共用） */
export async function sendAlert(summary: string): Promise<{ ok: boolean; detail: string }> {
  return feishuSend({
    msg_type: 'text',
    content: { text: `⚠️ NextCareer 今日采集/推送失败：${summary}` },
  })
}

function salaryText(j: JobRow): string {
  if (j.salaryMin && j.salaryMax) return `${j.salaryMin / 1000}k–${j.salaryMax / 1000}k`
  return '面议'
}

/** JD 摘要：剥空白截 ~100 字，未评分岗位判断「是干啥的」全靠它 */
function jdDigest(j: JobRow): string {
  const text = (j.description || '').replace(/\s+/g, ' ').trim()
  return text.length > 100 ? `${text.slice(0, 100)}…` : text
}

const WEB_BASE = process.env.WEB_BASE_URL || 'http://49.235.68.206'

interface Candidate {
  job: JobRow
  score: ScoreBreakdown
  kind: 'new' | 'repush'
}

export async function selectCandidates(prefs: Prefs, now: Date): Promise<Candidate[]> {
  const allJobs = (await db.select().from(jobs).orderBy(desc(jobs.collectedAt))) as JobRow[]
  const events = await db.select().from(feedbackEvents).orderBy(desc(feedbackEvents.createdAt))
  const pushRows = await db.select().from(pushLog)

  const adjustments = feedbackAdjustments(allJobs, events, prefs, now)
  const pushCount = new Map<string, number>()
  const firstPushAt = new Map<string, Date>()
  const jobsWithFeedback = new Set(events.map((e) => e.jobId))
  // 派生状态：点过「不合适」（最新反馈为 pass）的岗位永不进入推送候选（§3.6-13）
  const latestActionByJob = new Map<string, string>()
  for (const e of events) {
    if (!latestActionByJob.has(e.jobId)) latestActionByJob.set(e.jobId, e.action)
  }
  for (const r of pushRows) {
    if (!r.jobId) continue
    pushCount.set(r.jobId, (pushCount.get(r.jobId) ?? 0) + 1)
    const prev = firstPushAt.get(r.jobId)
    if (!prev || r.pushedAt < prev) firstPushAt.set(r.jobId, r.pushedAt)
  }

  const candidates: Candidate[] = []
  for (const job of allJobs) {
    if (latestActionByJob.get(job.id) === 'pass') continue
    const pushes = pushCount.get(job.id) ?? 0
    const score = buildScore(job, prefs, adjustments.get(job.id), now)
    if (pushes === 0) {
      // 新岗：未推过 + 最终分≥60 + 近 7 天入库
      const ageMs = now.getTime() - job.collectedAt.getTime()
      if (score.final >= PUSH_THRESHOLD && ageMs <= NEW_JOB_WINDOW_DAYS * 86400000) {
        candidates.push({ job, score, kind: 'new' })
      }
    } else if (pushes === 1) {
      // 重推岗：首推满 5 天且无任何反馈（重推不重新校验分数，§3.4 用户裁定）
      const first = firstPushAt.get(job.id)
      if (
        first &&
        now.getTime() - first.getTime() >= REPUSH_AFTER_DAYS * 86400000 &&
        !jobsWithFeedback.has(job.id)
      ) {
        candidates.push({ job, score, kind: 'repush' })
      }
    }
    // pushes >= 2：生命周期已满，永不重推
  }
  // 混在一起不分段：最终分降序，同分 posted_at 新→旧
  const postedTime = (d: string | null) => (d ? new Date(d).getTime() : 0)
  candidates.sort((a, b) => {
    if (b.score.final !== a.score.final) return b.score.final - a.score.final
    return postedTime(b.job.postedAt) - postedTime(a.job.postedAt)
  })
  return candidates.slice(0, TOP_N)
}

export async function pushJobs(prefs: Prefs): Promise<{
  pushed: number
  silent: boolean
  ok: boolean
  detail: string
}> {
  const now = new Date()
  const candidates = await selectCandidates(prefs, now)
  if (!candidates.length) {
    return { pushed: 0, silent: true, ok: true, detail: '两类候选均为空，静默不推' }
  }

  const lines = candidates.map(({ job, score }) => {
    const scoreText = `【匹配 ${score.final} 分】`
    const highlight = score.llmHighlight ? `\n看点：${score.llmHighlight}` : ''
    const digest = jdDigest(job)
    const act = (action: string, label: string) =>
      `[${label}](${WEB_BASE}/jobs?focus=${job.id}&action=${action})`
    return (
      `**${job.company}** · ${job.title} · ${salaryText(job)} · ${job.location || '地点未知'} ${scoreText}${highlight}\n` +
      `JD 摘要：${digest || '（无 JD 正文）'}\n` +
      `${act('interested', '感兴趣')} ${act('pass', '不合适')} ${act('applied', '已投递')} ｜ [查看 JD](${job.sourceUrl})`
    )
  })
  const card = {
    msg_type: 'interactive',
    card: {
      config: { wide_screen_mode: true },
      header: {
        template: 'blue',
        title: { tag: 'plain_text', content: `NextCareer 今日新岗位 ${candidates.length} 条` },
      },
      elements: [
        ...candidates.map((_, i) => ({
          tag: 'div',
          text: { tag: 'lark_md', content: lines[i] },
        })),
        { tag: 'hr' },
        {
          tag: 'note',
          elements: [{ tag: 'plain_text', content: '完整列表见 Web（岗位流按匹配分排序）' }],
        },
      ],
    },
  }

  const result = await feishuSend(card)
  if (!result.ok) {
    await sendAlert(`飞书推送失败（${result.detail}）`)
    return { pushed: 0, silent: false, ok: false, detail: result.detail }
  }
  // 推送成功才记 push_log（岗位级；失败不写 → 下午/次日重试同批，at-least-once）
  await db.insert(pushLog).values(
    candidates.map(({ job }) => ({ jobId: job.id, channel: 'feishu' })),
  )
  return { pushed: candidates.length, silent: false, ok: true, detail: 'ok' }
}

export { selectCandidates as _selectCandidatesForTest }
