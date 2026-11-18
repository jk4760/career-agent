// M4.5 施工项 1.3：三态卡片构建器（设计稿 §2.2/§2.3，全部飞书原生组件，不自绘颜色块）
// 卡片 JSON 2.0（schema 2.0）实战要点（官方组件文档 + 实测）：
// - 文本用 markdown 组件；按钮放 column_set→column.elements，behaviors:[{type:'callback'}] 才回传
// - 分栏高亮用 background_style（border/background 属性不存在，im/v1 会 200621 拒收）
// - 「查看 JD」走 behaviors open_url（链式按钮不触发回调）
import { and, desc, eq, inArray, isNull } from 'drizzle-orm'
import { feedbackEvents, jobs } from '../../../db/schema'
import { db } from '../db'
import { buildScore, feedbackAdjustments, type JobRow, type Prefs, type ScoreBreakdown } from '../scoring'

// 按钮 type 映射（设计稿 §2.1，写为常量；原生 button 无自定义色值）
export const BUTTON_TYPE = {
  interested: 'danger', // 感兴趣：亮红
  pass: 'default', // 不合适：灰
  applied: 'primary', // 已投递：蓝
  viewJd: 'primary', // 查看 JD：蓝（文案带 → 区分）
} as const

// 不合适六选一（卡片展示文案，提交时映射回 Web 枚举，见 feedback.ts CARD_REASON_TO_ENUM）
export const CARD_PASS_REASON_LABELS = [
  '职能不匹配',
  '薪资不满意',
  '地点不合适',
  '职级不匹配',
  '公司不考虑',
  '其他',
] as const

type Json = Record<string, unknown>

export interface CardFeedbackState {
  action: 'interested' | 'pass' | 'applied'
  reason: string | null
  eventId: string
  createdAt: Date
}

export interface CardJobEntry {
  job: JobRow
  score: ScoreBreakdown
  feedback: CardFeedbackState | null
  /** 态② 专用：该岗位当前处于「不合适原因选择中」（回调重建时由 stage=ask_reason 触发） */
  askReason?: boolean
}

function md(content: string): Json {
  return { tag: 'markdown', content }
}
function plain(text: string) {
  return { tag: 'plain_text', content: text }
}
function salaryText(job: JobRow): string {
  if (job.salaryMin && job.salaryMax) return `${job.salaryMin / 1000}k–${job.salaryMax / 1000}k`
  return '面议'
}
function truncate(text: string, n: number): string {
  const t = text.replace(/\s+/g, ' ').trim()
  return t.length > n ? `${t.slice(0, n)}…` : t
}

/** 回调按钮（点按回传 value 到 /feishu/callback） */
function callbackButton(content: string, type: string, value: Record<string, unknown>): Json {
  return {
    tag: 'button',
    text: plain(content),
    type,
    value,
    behaviors: [{ type: 'callback' }],
  }
}

/** 链接按钮（打开 URL，不触发回调） */
function linkButton(content: string, type: string, url: string): Json {
  return {
    tag: 'button',
    text: plain(content),
    type,
    behaviors: [{ type: 'open_url', default_url: url }],
  }
}

/** 按钮行：column_set 每列一个按钮（源码对「全列皆按钮」按按钮行排版） */
function buttonRow(buttons: Json[], flow = false): Json {
  return {
    tag: 'column_set',
    flex_mode: flow ? 'flow' : 'none',
    horizontal_spacing: 'medium',
    columns: buttons.map((b) => ({
      tag: 'column',
      width: 'auto',
      vertical_align: 'center',
      elements: [b],
    })),
  }
}

/** 态① 操作区：感兴趣（红）｜不合适（灰）｜已投递（蓝）｜查看 JD →（蓝链接） */
function actionRowState1(jobId: string, sourceUrl: string, cardJobs: string[]): Json {
  return buttonRow([
    callbackButton('感兴趣', BUTTON_TYPE.interested, { jobId, action: 'interested', stage: 'submit', cardJobs }),
    callbackButton('不合适', BUTTON_TYPE.pass, { jobId, action: 'pass', stage: 'ask_reason', cardJobs }),
    callbackButton('已投递', BUTTON_TYPE.applied, { jobId, action: 'applied', stage: 'submit', cardJobs }),
    linkButton('查看 JD →', BUTTON_TYPE.viewJd, sourceUrl),
  ])
}

/** 态② 原因选择（点「不合适」后原地替换，设计稿 §2.3；六按钮 flow 换行） */
function actionRowState2(jobId: string, cardJobs: string[]): Json[] {
  return [
    md('**不合适的原因是？**'),
    buttonRow(
      CARD_PASS_REASON_LABELS.map((label) =>
        callbackButton(label, 'default', { jobId, action: 'pass', stage: 'submit', reason: label, cardJobs }),
      ),
      true,
    ),
    md('点选即提交 · 10 分钟内可撤销'),
  ]
}

/** 态③ 已标记（含 10 分钟撤销窗口，设计稿 §2.3） */
function actionRowState3(entry: CardJobEntry, cardJobs: string[]): Json[] {
  const fb = entry.feedback!
  const actionLabel =
    fb.action === 'pass' ? '不合适' : fb.action === 'interested' ? '感兴趣' : '已投递'
  const reasonText = fb.reason ? ` · ${fb.reason}` : ''
  const rows: Json[] = [md(`<font color='green'>✓ 已标记：${actionLabel}${reasonText}</font>`)]
  const ageMs = Date.now() - fb.createdAt.getTime()
  if (ageMs <= 10 * 60 * 1000) {
    rows.push(
      buttonRow([
        callbackButton('撤销', 'default', { jobId: entry.job.id, stage: 'undo', eventId: fb.eventId, cardJobs }),
      ]),
    )
  }
  return rows
}

/** 单岗位区块：column_set 浅灰底高亮块（grey-50）+ 五行内容（设计稿 §2.2） */
function jobBlock(entry: CardJobEntry, cardJobs: string[]): Json {
  const { job, score, feedback } = entry
  const rows: Json[] = [
    md(`**${job.company} · ${job.title}**`),
    md(`${salaryText(job)} · ${job.location || '地点未知'}　<font color='blue'>匹配 ${score.final} 分</font>`),
  ]
  if (score.llmHighlight) rows.push(md(`看点：${score.llmHighlight}`))
  const digest = truncate(job.description || '', 100)
  if (digest) rows.push(md(digest))

  if (entry.askReason) rows.push(...actionRowState2(job.id, cardJobs))
  else if (feedback) rows.push(...actionRowState3(entry, cardJobs))
  else rows.push(actionRowState1(job.id, job.sourceUrl, cardJobs))

  return {
    tag: 'column_set',
    flex_mode: 'none',
    background_style: 'grey-50',
    columns: [
      { tag: 'column', width: 'weighted', weight: 1, padding: '8px', elements: rows },
    ],
  }
}

/** 整张推送卡片（schema 2.0，header wathet，底注见设计稿 §2.2） */
export function buildPushCard(entries: CardJobEntry[], cardJobs: string[]): Json {
  const withHr: Json[] = []
  entries.forEach((e, i) => {
    if (i > 0) withHr.push({ tag: 'hr' })
    withHr.push(jobBlock(e, cardJobs))
  })
  withHr.push({ tag: 'hr' })
  withHr.push(md("<font color='grey'>完整列表见 Web（岗位流按匹配分排序）</font>")) // v2 无 note 组件，用灰字 markdown
  return {
    schema: '2.0',
    config: { wide_screen_mode: true, update_multi: true },
    header: {
      template: 'wathet',
      title: plain(`NextCareer 今日新岗位 ${entries.length} 条`),
    },
    body: { elements: withHr },
  }
}

/** 回调重建卡片用：按 jobId 列表装配（分数实时重算 + 每岗最新有效反馈） */
export async function assembleEntries(
  jobIds: string[],
  prefs: Prefs,
  opts?: { askReasonJobId?: string },
): Promise<CardJobEntry[]> {
  if (!jobIds.length) return []
  const allJobs = (await db.select().from(jobs)) as JobRow[]
  const allEvents = await db.select().from(feedbackEvents).where(isNull(feedbackEvents.canceledAt))
  const now = new Date()
  const adjustments = feedbackAdjustments(allJobs, allEvents, prefs, now)
  const byId = new Map(allJobs.map((j) => [j.id, j]))

  const fbRows = await db
    .select()
    .from(feedbackEvents)
    .where(and(inArray(feedbackEvents.jobId, jobIds), isNull(feedbackEvents.canceledAt)))
    .orderBy(desc(feedbackEvents.createdAt))
  const latestFb = new Map<string, (typeof fbRows)[number]>()
  for (const r of fbRows) {
    if (!latestFb.has(r.jobId)) latestFb.set(r.jobId, r)
  }

  const entries: CardJobEntry[] = []
  for (const id of jobIds) {
    const job = byId.get(id)
    if (!job) continue
    const fb = latestFb.get(id)
    entries.push({
      job,
      score: buildScore(job, prefs, adjustments.get(id), now),
      feedback: fb
        ? {
            action: fb.action as 'interested' | 'pass' | 'applied',
            reason: fb.reason,
            eventId: fb.id,
            createdAt: fb.createdAt,
          }
        : null,
      askReason: opts?.askReasonJobId === id,
    })
  }
  return entries
}

/** 回调响应：同步更新卡片（飞书卡片回传交互响应格式） */
export function cardUpdateResponse(card: Json): Json {
  return { card: { type: 'raw', data: card } }
}

export function toastResponse(type: 'success' | 'error' | 'info' | 'warning', content: string): Json {
  return { toast: { type, content } }
}
