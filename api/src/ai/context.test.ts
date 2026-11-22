import assert from 'node:assert/strict'
import { after, before, beforeEach, test } from 'node:test'
import { migrate } from 'drizzle-orm/postgres-js/migrator'

const testUrl = new URL(process.env.DATABASE_URL!)
testUrl.pathname = '/nextcareer_m5_test'
process.env.DATABASE_URL = testUrl.toString()

const { db, client } = await import('../db')
const schema = await import('../../../db/schema')
const { assembleContext, CONTEXT_LIMITS } = await import('./context')

const PREF_ID = '00000000-0000-4000-8000-00000000b501'
const MATERIAL_A = '00000000-0000-4000-8000-00000000b502'
const MATERIAL_B = '00000000-0000-4000-8000-00000000b503'

before(async () => {
  await migrate(db, { migrationsFolder: '/app/api/drizzle' })
})
beforeEach(async () => {
  await db.delete(schema.preferences)
  await db.delete(schema.materials)
  await db.insert(schema.preferences).values({ id: PREF_ID, roles: ['产品经理'], backgroundText: '虚构简历正文', updatedAt: new Date() })
  await db.insert(schema.materials).values([
    { id: MATERIAL_A, project: '虚构项目 A', title: '虚构素材 A', content: '虚构正文 A', updatedAt: new Date() },
    { id: MATERIAL_B, project: '虚构项目 B', title: '虚构素材 B', content: '不应出现的正文', updatedAt: new Date() },
  ])
})
after(async () => {
  await db.delete(schema.preferences)
  await db.delete(schema.materials)
  await client.end()
})

test('只组装明确选择的偏好、简历与素材', async () => {
  const result = await assembleContext({ includePreferences: true, resumeId: PREF_ID, materialIds: [MATERIAL_A], jobIds: [] })
  assert.ok(result.prompt.includes('虚构简历正文'))
  assert.ok(result.prompt.includes('虚构正文 A'))
  assert.ok(!result.prompt.includes('不应出现的正文'))
  assert.equal(result.snapshot.sources.length, 3)
  assert.equal(result.snapshot.sources.some((source) => 'content' in source), false)
})

test('素材最多 3 个，超限不能冒充完整上下文', async () => {
  await assert.rejects(assembleContext({ includePreferences: false, resumeId: null, materialIds: [MATERIAL_A, MATERIAL_B, MATERIAL_A, MATERIAL_B], jobIds: [] }))
  await db.update(schema.preferences).set({ backgroundText: '虚'.repeat(CONTEXT_LIMITS.resumeChars + 1) })
  await assert.rejects(assembleContext({ includePreferences: false, resumeId: PREF_ID, materialIds: [], jobIds: [] }))
})

test('预估接口口径返回实际字数和超限标记，不调用模型', async () => {
  const longText = '虚'.repeat(CONTEXT_LIMITS.resumeChars + 1)
  await db.update(schema.preferences).set({ backgroundText: longText })
  const result = await assembleContext({ includePreferences: false, resumeId: PREF_ID, materialIds: [], jobIds: [] }, false)
  assert.equal(result.totalChars, longText.length)
  assert.equal(result.exceeds, true)
})
