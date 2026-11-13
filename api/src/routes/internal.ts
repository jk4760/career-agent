// M4 施工项 3/4：内网接口（仅 compose 内网可达，nginx 只转发 /api/，公网不可见）
import { Hono } from 'hono'
import { z } from 'zod'
import { preferences } from '../../../db/schema'
import { db } from '../db'
import { runScoring, scoreRunState } from '../llm/scorer'
import { pushJobs, selectCandidates, sendAlert } from '../push'
import type { Prefs } from '../scoring'

const scoreSchema = z.object({
  jobIds: z.array(z.string().uuid()).optional(),
  sinceDays: z.number().int().min(1).max(365).optional(),
  all: z.boolean().optional(),
  async: z.boolean().optional(),
})

export async function loadPrefs(): Promise<Prefs> {
  const [row] = await db.select().from(preferences).limit(1)
  return {
    roles: row?.roles ?? [],
    locations: row?.locations ?? [],
    salaryMin: row?.salaryMin ?? null,
    keywordsInclude: row?.keywordsInclude ?? [],
    keywordsExclude: row?.keywordsExclude ?? [],
    experienceMin: row?.experienceMin ?? null,
    backgroundText: row?.backgroundText ?? null,
  }
}

export const internalRoute = new Hono()
  // 评分：daily.sh 推送前同步调用（默认补评近 7 天未评分/版本过期岗位）；
  // sinceDays=60 → 重评近 60 天（偏好变更触发②）；all=true → 全量重评（prompt 升级触发③）
  .post('/score', async (c) => {
    const body = await c.req.json().catch(() => ({}))
    const parsed = scoreSchema.safeParse(body)
    if (!parsed.success) return c.json({ error: parsed.error.issues }, 400)
    const prefs = await loadPrefs()
    const result = await runScoring(prefs, parsed.data)
    return c.json(result, result.mode === 'busy' ? 409 : 200)
  })

  .get('/score/status', (c) => c.json(scoreRunState()))

  // 推送：daily.sh 调用。mode 仅作日志标记（collect-and-push / push-only 选择逻辑一致）
  .post('/push', async (c) => {
    const body = await c.req.json().catch(() => ({}))
    const mode = typeof body.mode === 'string' ? body.mode : 'push-only'
    console.log(`[push] 开始推送（mode=${mode}）`)
    const prefs = await loadPrefs()
    const result = await pushJobs(prefs)
    console.log(`[push] 结果：${JSON.stringify(result)}`)
    return c.json(result, result.ok ? 200 : 500)
  })

  // 推送预览（自测用，不发消息不写 push_log）
  .post('/push/preview', async (c) => {
    const prefs = await loadPrefs()
    const candidates = await selectCandidates(prefs, new Date())
    return c.json(
      candidates.map(({ job, score, kind }) => ({
        id: job.id,
        title: job.title,
        company: job.company,
        kind,
        final: score.final,
        llm: score.llm,
        rule: score.rule,
        feedback: score.feedback.total,
        highlight: score.llmHighlight,
        jdDigest: (job.description || '').replace(/\s+/g, ' ').trim().slice(0, 100),
      })),
    )
  })

  // ⚠️ 告警：ops 脚本在采集/评分失败时调用
  .post('/alert', async (c) => {
    const body = await c.req.json().catch(() => ({}))
    const text = typeof body.text === 'string' && body.text ? body.text : '未指明原因'
    const result = await sendAlert(text)
    return c.json(result, result.ok ? 200 : 500)
  })
