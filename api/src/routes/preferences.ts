import { Hono } from 'hono'
import { z } from 'zod'
import { preferences } from '../../../db/schema'
import { db } from '../db'

const preferencesSchema = z.object({
  id: z.string().uuid(),
  industries: z.array(z.string()),
  roles: z.array(z.string()),
  locations: z.array(z.string()),
  salaryMin: z.number().nullable(),
  keywordsInclude: z.array(z.string()),
  keywordsExclude: z.array(z.string()),
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
          updatedAt: new Date(),
        },
      })
      .returning()
    return c.json(saved)
  })
