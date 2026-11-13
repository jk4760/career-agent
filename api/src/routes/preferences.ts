import { Hono } from 'hono'
import { z } from 'zod'
import { preferences } from '../../../db/schema'
import { db } from '../db'
import { runScoring } from '../llm/scorer'

const preferencesSchema = z.object({
  id: z.string().uuid(),
  industries: z.array(z.string()),
  roles: z.array(z.string()),
  locations: z.array(z.string()),
  salaryMin: z.number().nullable(),
  keywordsInclude: z.array(z.string()),
  keywordsExclude: z.array(z.string()),
  experienceMin: z.number().int().nullable().optional(),
  // M4：个人背景自述；不传则不动该字段（兼容旧客户端全量保存）
  backgroundText: z.string().nullable().optional(),
  updatedAt: z.string(),
})

export const preferencesRoute = new Hono()
  // getPreferences()：单例，取第一行
  .get('/', async (c) => {
    const [row] = await db.select().from(preferences).limit(1)
    if (!row) return c.json({ error: 'preferences not found' }, 404)
    return c.json(row)
  })

  // savePreferences(p)：按 id upsert
  .put('/', async (c) => {
    const parsed = preferencesSchema.safeParse(await c.req.json())
    if (!parsed.success) return c.json({ error: parsed.error.issues }, 400)
    const p = parsed.data
    const [saved] = await db
      .insert(preferences)
      .values({ ...p, updatedAt: new Date() })
      .onConflictDoUpdate({
        target: preferences.id,
        set: {
          industries: p.industries,
          roles: p.roles,
          locations: p.locations,
          salaryMin: p.salaryMin,
          keywordsInclude: p.keywordsInclude,
          keywordsExclude: p.keywordsExclude,
          experienceMin: p.experienceMin ?? null,
          ...(p.backgroundText !== undefined ? { backgroundText: p.backgroundText } : {}),
          updatedAt: new Date(),
        },
      })
      .returning()
    // M4 重评触发②：偏好/个人背景变更 → 异步重评近 60 天岗位（失败降级不阻塞保存）
    void runScoring(
      {
        roles: saved.roles ?? [],
        locations: saved.locations ?? [],
        salaryMin: saved.salaryMin ?? null,
        keywordsInclude: saved.keywordsInclude ?? [],
        keywordsExclude: saved.keywordsExclude ?? [],
        experienceMin: saved.experienceMin ?? null,
        backgroundText: saved.backgroundText ?? null,
      },
      { sinceDays: 60, async: true },
    ).catch((e) => console.error('[llm] 偏好变更重评触发失败:', e))
    return c.json(saved)
  })
