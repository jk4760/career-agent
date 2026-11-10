import { sql, desc, eq } from 'drizzle-orm'
import { Hono } from 'hono'
import { z } from 'zod'
import { interviewQuestions, materials } from '../../../db/schema'
import { db } from '../db'

const attachmentMetaSchema = z.object({
  name: z.string(),
  size: z.number(),
  mime: z.string(),
  importedAt: z.string(),
})

const materialSchema = z.object({
  id: z.string().uuid(),
  project: z.string().min(1),
  title: z.string().min(1),
  role: z.string().nullable(),
  duration: z.string().nullable(),
  capabilityL1: z.string().nullable(),
  capabilityL2: z.string().nullable(),
  tags: z.array(z.string()),
  facets: z.array(z.string()),
  metrics: z.string().nullable(),
  content: z.string().nullable(),
  attachments: z.array(attachmentMetaSchema),
  others: z.record(z.string(), z.unknown()).nullable(),
  updatedAt: z.string(),
})

export const materialsRoute = new Hono()
  // listMaterials()
  .get('/', async (c) => {
    const rows = await db.select().from(materials).orderBy(desc(materials.updatedAt))
    return c.json(rows)
  })

  // saveMaterial(m)：按 id upsert
  .post('/', async (c) => {
    const parsed = materialSchema.safeParse(await c.req.json())
    if (!parsed.success) return c.json({ error: parsed.error.issues }, 400)
    const m = parsed.data
    const values = {
      ...m,
      updatedAt: new Date(),
      others: m.others ?? null,
      attachments: m.attachments,
    }
    const [saved] = await db
      .insert(materials)
      .values(values)
      .onConflictDoUpdate({
        target: materials.id,
        set: {
          project: values.project,
          title: values.title,
          role: values.role,
          duration: values.duration,
          capabilityL1: values.capabilityL1,
          capabilityL2: values.capabilityL2,
          tags: values.tags,
          facets: values.facets,
          metrics: values.metrics,
          content: values.content,
          attachments: values.attachments,
          others: values.others,
          updatedAt: values.updatedAt,
        },
      })
      .returning()
    return c.json(saved)
  })

  // deleteMaterial(id)：解除问题关联后删除
  .delete('/:id', async (c) => {
    const id = c.req.param('id')
    await db
      .update(interviewQuestions)
      .set({ linkedMaterialId: null })
      .where(eq(interviewQuestions.linkedMaterialId, id))
    await db.delete(materials).where(eq(materials.id, id))
    return c.json({ ok: true })
  })

export const facetsRoute = new Hono().get('/', async (c) => {
  // listFacets()：库内去重计数，不按前端全量拉取
  const rows = await db.execute<{ value: string; count: number }>(
    sql`SELECT unnest(facets) AS value, count(*)::int AS count
        FROM materials GROUP BY value ORDER BY count DESC`,
  )
  return c.json([...rows])
})
