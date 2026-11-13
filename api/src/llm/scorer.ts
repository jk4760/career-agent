// M4 施工项 3：LLM 评分执行器（Moonshot/Kimi API；失败降级留空，永不阻塞采集与推送）
import { desc, eq, isNull, or, sql } from 'drizzle-orm'
import { jobs } from '../../../db/schema'
import { db } from '../db'
import type { Prefs } from '../scoring'
import { PROMPT_VERSION, systemPrompt, userPrompt } from './scorePrompt'

const BASE_URL = process.env.MOONSHOT_BASE_URL || 'https://api.moonshot.cn/v1'
const MODEL = process.env.MOONSHOT_MODEL || 'kimi-k3'
const REQUEST_TIMEOUT_MS = 45_000
const PACE_MS = 200 // 串行低频发评，避免突发

export interface LlmResult {
  score: number
  reasons: string[]
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

export async function scoreJobWithLLM(
  job: {
    title: string
    company: string
    location: string | null
    salaryMin: number | null
    salaryMax: number | null
    description: string | null
  },
  prefs: Prefs,
): Promise<LlmResult | null> {
  const apiKey = process.env.MOONSHOT_API_KEY
  if (!apiKey) {
    console.error('[llm] MOONSHOT_API_KEY 未配置，评分跳过（降级规则分）')
    return null
  }
  try {
    const resp = await fetch(`${BASE_URL}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: MODEL,
        temperature: 0,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: systemPrompt() },
          { role: 'user', content: userPrompt(job, prefs) },
        ],
      }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    })
    if (!resp.ok) {
      console.error(`[llm] HTTP ${resp.status}: ${(await resp.text()).slice(0, 200)}`)
      return null
    }
    const data = (await resp.json()) as {
      choices?: { message?: { content?: string } }[]
    }
    const content = data.choices?.[0]?.message?.content ?? ''
    const parsed = JSON.parse(content) as { score?: unknown; reasons?: unknown }
    const score = Number(parsed.score)
    if (!Number.isFinite(score) || score < 0 || score > 100) {
      console.error(`[llm] 非法分数输出: ${content.slice(0, 120)}`)
      return null
    }
    const reasons = Array.isArray(parsed.reasons)
      ? parsed.reasons.filter((r): r is string => typeof r === 'string').slice(0, 2)
      : []
    return { score: Math.round(score), reasons }
  } catch (e) {
    console.error(`[llm] 调用失败: ${e instanceof Error ? e.message : e}`)
    return null
  }
}

type TargetRow = typeof jobs.$inferSelect

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
    return rows
  }
  if (opts.all) {
    return db.select().from(jobs).orderBy(desc(jobs.collectedAt))
  }
  const days = opts.sinceDays ?? 7
  const rows = await db
    .select()
    .from(jobs)
    .where(sql`collected_at > now() - make_interval(days => ${days})`)
    .orderBy(desc(jobs.collectedAt))
  // 默认只补评：未评分或 prompt 版本过期；显式 sinceDays 重评（触发②）则全量重评
  if (opts.sinceDays === undefined) {
    return rows.filter(
      (r) => !r.llmEval || r.llmEval.prompt_version !== PROMPT_VERSION,
    )
  }
  return rows
}

/**
 * 评分入口。async=false → 同步跑完返回计数（daily.sh 推送前调用）；
 * async=true → 后台跑（偏好变更/全量迁移），状态见 scoreRunState()。
 * 单实例互斥：已有评分在跑时新任务直接拒绝（daily.sh 下 run 会再来）。
 */
export async function runScoring(
  prefs: Prefs,
  opts: { jobIds?: string[]; sinceDays?: number; all?: boolean; async?: boolean },
): Promise<{ started: number; mode: 'sync' | 'async' | 'busy'; scored?: number; failed?: number }> {
  if (state.running) return { started: 0, mode: 'busy' }
  const targets = await pickTargets(opts)
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
        const result = await scoreJobWithLLM(job, prefs)
        if (result) {
          await db
            .update(jobs)
            .set({
              llmEval: {
                score: result.score,
                reasons: result.reasons,
                prompt_version: PROMPT_VERSION,
                scored_at: new Date().toISOString(),
              },
            })
            .where(eq(jobs.id, job.id))
          state.scored += 1
        } else {
          state.failed += 1 // 降级：llm_eval 保持 NULL，按规则分排序
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
