import assert from 'node:assert/strict'
import { after, before, beforeEach, test } from 'node:test'
import { eq } from 'drizzle-orm'
import { migrate } from 'drizzle-orm/postgres-js/migrator'

const testUrl = new URL(process.env.DATABASE_URL!)
testUrl.pathname = '/nextcareer_m5_test'
process.env.DATABASE_URL = testUrl.toString()

const { db, client } = await import('./db')
const schema = await import('../../db/schema')
const { selectCandidates } = await import('./push')

const NOW = new Date('2026-11-25T08:00:00.000Z')
const JOB_ID = '00000000-0000-4000-8000-00000000f501'
const PREFS = { roles: [], locations: [], salaryMin: null, keywordsInclude: [], keywordsExclude: [], experienceMin: null, backgroundText: null }

before(async () => {
  await migrate(db, { migrationsFolder: '/app/api/drizzle' })
})

beforeEach(async () => {
  await db.delete(schema.feedbackEvents)
  await db.delete(schema.pushLog)
  await db.delete(schema.jobs)
  await db.insert(schema.jobs).values({
    id: JOB_ID,
    title: '虚构岗位',
    company: '虚构公司',
    location: '上海',
    source: 'fake',
    sourceUrl: 'https://example.com/job',
    description: '虚构 JD',
    collectedAt: new Date('2026-11-24T08:00:00.000Z'),
    postedAt: '2026-11-24',
    dedupKey: 'fake-push-job',
    llmEval: { score: 80, reasons: [], prompt_version: 'fake', scored_at: NOW.toISOString() },
  })
})

after(async () => {
  await db.delete(schema.feedbackEvents)
  await db.delete(schema.pushLog)
  await db.delete(schema.jobs)
  await client.end()
})

async function setScore(score: number) {
  await db.update(schema.jobs).set({
    llmEval: { score, reasons: [], prompt_version: 'fake', scored_at: NOW.toISOString() },
  }).where(eq(schema.jobs.id, JOB_ID))
}

async function markPushed() {
  await db.insert(schema.pushLog).values({
    jobId: JOB_ID,
    channel: 'feishu',
    pushedAt: new Date('2026-11-19T08:00:00.000Z'),
  })
}

test('首推低分拦截，合格岗位进入新岗候选', async () => {
  await setScore(59)
  assert.deepEqual(await selectCandidates(PREFS, NOW), [])
  await setScore(60)
  const candidates = await selectCandidates(PREFS, NOW)
  assert.equal(candidates.length, 1)
  assert.equal(candidates[0].kind, 'new')
})

test('重推低分拦截，合格岗位进入重推候选', async () => {
  await markPushed()
  await setScore(22)
  assert.deepEqual(await selectCandidates(PREFS, NOW), [])
  await setScore(80)
  const candidates = await selectCandidates(PREFS, NOW)
  assert.equal(candidates.length, 1)
  assert.equal(candidates[0].kind, 'repush')
})

test('首推后分数下降不能重推，恢复合格才可重推', async () => {
  await markPushed()
  await setScore(85)
  assert.equal((await selectCandidates(PREFS, NOW)).length, 1)
  await setScore(20)
  assert.deepEqual(await selectCandidates(PREFS, NOW), [])
  await setScore(90)
  assert.equal((await selectCandidates(PREFS, NOW)).length, 1)
})

test('重推仍保留反馈排除和生命周期次数规则', async () => {
  await markPushed()
  await db.insert(schema.feedbackEvents).values({ jobId: JOB_ID, action: 'pass' })
  assert.deepEqual(await selectCandidates(PREFS, NOW), [])
  await db.insert(schema.pushLog).values({ jobId: JOB_ID, channel: 'feishu', pushedAt: new Date('2026-11-20T08:00:00.000Z') })
  assert.deepEqual(await selectCandidates(PREFS, NOW), [])
})
