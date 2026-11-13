// M4 施工项 3/4：内网接口（仅 compose 内网可达，nginx 只转发 /api/，公网不可见）
import { Hono } from 'hono'
import { z } from 'zod'
import { preferences } from '../../../db/schema'
import { db } from '../db'
import { runScoring, scoreRunState } from '../llm/scorer'
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
