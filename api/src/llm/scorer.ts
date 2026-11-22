// M4 施工项 3：LLM 评分执行器（Moonshot/Kimi API；失败降级留空，永不阻塞采集与推送）
// M4 修复批（2026-11-16）：预算闸门（默认只补未评分 + 单次硬上限 60）、
// 干跑分解日志、429 退避、per-job 失败明细、k3.1-pro + reasoning_effort=low 降本
import { desc, eq, sql } from 'drizzle-orm'
import { jobs } from '../../../db/schema'
import { db } from '../db'
import {
  markModelCallRunning,
  reserveModelCall,
  settleModelCall,
  usageFromOpenAI,
} from '../ai/budget'
import { estimateTokens } from '../ai/pricing'
import type { Prefs } from '../scoring'
import { PROMPT_VERSION, systemPrompt, userPrompt } from './scorePrompt'

const BASE_URL = process.env.MOONSHOT_BASE_URL || 'https://api.moonshot.cn/v1'
const MODEL = process.env.MOONSHOT_MODEL || 'kimi-k3.1-pro'
const REQUEST_TIMEOUT_MS = 45_000
const MAX_COMPLETION_TOKENS = 1024
const PACE_MS = 1000 // 串行低频发评；该账号 RPM 上限低（429 由重试兜底）
const MAX_PER_RUN = 60 // 单次评分硬上限（修复批项 1.2），超出顺延不得静默扩大

export interface LlmResult {
  score: number
  reasons: string[]
  highlight: string
}

export interface ScoreRunState {
  running: boolean
  total: number
  done: number
  scored: number
  failed: number
  startedAt: string | null
  finishedAt: string | null
  lastError: string | null
}

const state: ScoreRunState = {
  running: false,
  total: 0,
  done: 0,
  scored: 0,
  failed: 0,
  startedAt: null,
  finishedAt: null,
  lastError: null,
}

export function scoreRunState(): ScoreRunState {
  return { ...state }
}

export interface ScoreOutcome {
  result: LlmResult | null
  /** 失败原因（HTTP 状态码 + 错误前 200 字符）；成功时为 null */
  error: string | null
}

export async function scoreJobWithLLM(
  job: {
    id?: string
    title: string
    company: string
    location: string | null
    salaryMin: number | null
    salaryMax: number | null
    description: string | null
  },
  prefs: Prefs,
): Promise<ScoreOutcome> {
  const apiKey = process.env.MOONSHOT_API_KEY
  if (!apiKey) {
    return { result: null, error: 'MOONSHOT_API_KEY 未配置（降级规则分）' }
  }
  // 429 限流重试（该账号 RPM 上限低，实测错误提示 1s 后可重试）；其余 4xx/5xx 不重试
  const backoffMs = [0, 2000, 4000, 8000]
  let lastError = 'unknown'
  for (let attempt = 0; attempt < backoffMs.length; attempt++) {
    if (attempt > 0) await new Promise((r) => setTimeout(r, backoffMs[attempt]))
    let outcome: CallOutcome
    try {
      outcome = await callLLM(job, prefs, apiKey)
    } catch (error) {
      const code = error instanceof Error && 'code' in error ? String(error.code) : 'UPSTREAM_ERROR'
      if (code === 'BUDGET_EXCEEDED' || code === 'BUDGET_CONFIG_MISSING') {
        return { result: null, error: code }
      }
      throw error
    }
    if (outcome.kind === 'retry') {
      lastError = 'HTTP 429 限流（重试耗尽）'
      continue
    }
    if (outcome.kind === 'fail') return { result: null, error: outcome.error }
    return { result: outcome.result, error: null }
  }
  return { result: null, error: lastError }
}

type CallOutcome =
  | { kind: 'ok'; result: LlmResult }
  | { kind: 'retry' }
  | { kind: 'fail'; error: string }

async function callLLM(
  job: Parameters<typeof scoreJobWithLLM>[0],
  prefs: Prefs,
  apiKey: string,
): Promise<CallOutcome> {
  const messages = [
    { role: 'system', content: systemPrompt() },
    { role: 'user', content: userPrompt(job, prefs) },
  ]
  const reservation = await reserveModelCall({
    purpose: 'job_scoring',
    provider: 'moonshot',
    model: MODEL,
    estimatedInputTokens: estimateTokens(JSON.stringify(messages)),
    maxCompletionTokens: MAX_COMPLETION_TOKENS,
    businessId: job.id,
  })
  await markModelCallRunning(reservation.requestId)
  let settled = false
  try {
    const resp = await fetch(`${BASE_URL}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: MODEL,
        reasoning_effort: 'low',
        max_completion_tokens: MAX_COMPLETION_TOKENS,
        response_format: { type: 'json_object' },
        messages,
      }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    })
    const bodyText = await resp.text()
    let data: { choices?: { message?: { content?: string } }[]; usage?: unknown }
    try {
      data = JSON.parse(bodyText) as typeof data
    } catch {
      data = {}
    }
    await settleModelCall({
      requestId: reservation.requestId,
      usage: usageFromOpenAI(data),
      failed: !resp.ok,
      errorCode: resp.ok ? undefined : `HTTP_${resp.status}`,
    })
    settled = true
    if (resp.status === 429) return { kind: 'retry' }
    if (!resp.ok) {
      return { kind: 'fail', error: `HTTP ${resp.status}: ${bodyText.slice(0, 200)}` }
    }
    const content = data.choices?.[0]?.message?.content ?? ''
    const parsed = JSON.parse(content) as { score?: unknown; reasons?: unknown }
    const score = Number(parsed.score)
    if (!Number.isFinite(score) || score < 0 || score > 100) {
      return { kind: 'fail', error: `非法分数输出: ${content.slice(0, 120)}` }
    }
    const reasons = Array.isArray(parsed.reasons)
      ? parsed.reasons.filter((r): r is string => typeof r === 'string').slice(0, 2)
      : []
    const highlight =
      typeof (parsed as { highlight?: unknown }).highlight === 'string'
        ? ((parsed as { highlight: string }).highlight.slice(0, 60) as string)
        : ''
    return { kind: 'ok', result: { score: Math.round(score), reasons, highlight } }
  } catch (e) {
    if (!settled) {
      await settleModelCall({
        requestId: reservation.requestId,
        usage: null,
        failed: true,
        errorCode: 'UPSTREAM_ERROR',
      })
    }
    return { kind: 'fail', error: `调用异常: ${e instanceof Error ? e.message : e}` }
  }
}

type TargetRow = typeof jobs.$inferSelect

/** 干跑分解（修复批项 0）：正式调用 API 前打印目标构成，解释每次队列怎么算出来的 */
function breakdownOf(rows: TargetRow[]): string {
  const unscored = rows.filter((r) => !r.llmEval).length
  const staleV10 = rows.filter((r) => r.llmEval?.prompt_version === 'v1.0').length
  const staleOther = rows.filter(
    (r) => r.llmEval && r.llmEval.prompt_version !== PROMPT_VERSION && r.llmEval.prompt_version !== 'v1.0',
  ).length
  return `unscored=${unscored} / stale-v1.0=${staleV10} / stale-其他=${staleOther} / 合计=${rows.length}`
}

async function pickTargets(opts: {
  jobIds?: string[]
  sinceDays?: number
  all?: boolean
}): Promise<TargetRow[]> {
  if (opts.jobIds) {
    // 显式传了 jobIds（含空数组）就严格按它，空 = 无事可做
    const rows: TargetRow[] = []
    for (const id of opts.jobIds) {
      const [row] = await db.select().from(jobs).where(eq(jobs.id, id))
      if (row) rows.push(row)
    }
    console.log(`[llm] 干跑：显式 jobIds=${rows.length}`)
    return rows
  }
  if (opts.all) {
    const rows = await db.select().from(jobs).orderBy(desc(jobs.collectedAt))
    console.log(`[llm] 干跑（all=true 全量重评）：${breakdownOf(rows)}`)
    return rows
  }
  const days = opts.sinceDays ?? 7
  const rows = await db
    .select()
    .from(jobs)
    .where(sql`collected_at > now() - make_interval(days => ${days})`)
    .orderBy(desc(jobs.collectedAt))
  const policy = opts.sinceDays === undefined ? '默认（只补未评分）' : `显式重评近 ${days} 天`
  console.log(`[llm] 干跑（${policy}）：池 ${breakdownOf(rows)}`)
  // 修复批项 1.1/1.3：默认只评「近 7 天入库且未评分」；prompt_version 陈旧存量
  // 不自动重评，只有显式传 sinceDays/all 才动（人工触发）
  if (opts.sinceDays === undefined) {
    return rows.filter((r) => !r.llmEval)
  }
  return rows
}

/**
 * 评分入口。async=false → 同步跑完返回计数（daily.sh 推送前调用）；
 * async=true → 后台跑（偏好变更/全量迁移），状态见 scoreRunState()。
 * 单实例互斥：已有评分在跑时新任务直接拒绝（daily.sh 下 run 会再来）。
 * 单次硬上限 MAX_PER_RUN 条，超出顺延（修复批项 1.2）。
 */
export async function runScoring(
  prefs: Prefs,
  opts: { jobIds?: string[]; sinceDays?: number; all?: boolean; async?: boolean },
): Promise<{ started: number; mode: 'sync' | 'async' | 'busy'; scored?: number; failed?: number }> {
  if (state.running) return { started: 0, mode: 'busy' }
  const picked = await pickTargets(opts)
  const deferred = Math.max(0, picked.length - MAX_PER_RUN)
  const targets = picked.slice(0, MAX_PER_RUN)
  if (deferred > 0) console.log(`[llm] 单次上限 ${MAX_PER_RUN} 条：deferred=${deferred} 条，留待下次`)
  console.log(`[llm] 本次评分目标 ${targets.length} 条`)
  if (!targets.length) return { started: 0, mode: opts.async ? 'async' : 'sync', scored: 0, failed: 0 }

  const execute = async () => {
    state.running = true
    state.total = targets.length
    state.done = 0
    state.scored = 0
    state.failed = 0
    state.startedAt = new Date().toISOString()
    state.finishedAt = null
    state.lastError = null
    for (const job of targets) {
      try {
        const { result, error } = await scoreJobWithLLM(job, prefs)
        if (result) {
          await db
            .update(jobs)
            .set({
              llmEval: {
                score: result.score,
                reasons: result.reasons,
                highlight: result.highlight,
                prompt_version: PROMPT_VERSION,
                scored_at: new Date().toISOString(),
              },
            })
            .where(eq(jobs.id, job.id))
          state.scored += 1
        } else {
          state.failed += 1 // 降级：llm_eval 保持 NULL，按规则分排序
          state.lastError = error ?? 'unknown'
          console.error(`[llm] 评分失败 job=${job.id}：${state.lastError}`)
        }
      } catch (e) {
        state.failed += 1
        state.lastError = e instanceof Error ? e.message : String(e)
        console.error(`[llm] 评分异常 job=${job.id}: ${state.lastError}`)
      }
      state.done += 1
      if (state.done % 20 === 0) {
        console.log(`[llm] 评分进度 ${state.done}/${state.total}（成功 ${state.scored} 失败 ${state.failed}）`)
      }
      if (state.lastError === 'BUDGET_EXCEEDED' || state.lastError === 'BUDGET_CONFIG_MISSING') {
        console.log(`[llm] ${state.lastError}：停止本轮新评分，未评分岗位留待后续运行`)
        break
      }
      await new Promise((r) => setTimeout(r, PACE_MS))
    }
    state.running = false
    state.finishedAt = new Date().toISOString()
    console.log(`[llm] 评分完成：${state.scored} 成功 / ${state.failed} 失败（共 ${state.total}）`)
  }

  if (opts.async) {
    void execute()
    return { started: targets.length, mode: 'async' }
  }
  await execute()
  return { started: targets.length, mode: 'sync', scored: state.scored, failed: state.failed }
}
