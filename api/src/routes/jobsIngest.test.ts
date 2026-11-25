import assert from 'node:assert/strict'
import { after, before, beforeEach, test } from 'node:test'
import { Hono } from 'hono'
import { migrate } from 'drizzle-orm/postgres-js/migrator'

const testUrl = new URL(process.env.DATABASE_URL!)
testUrl.pathname = '/nextcareer_m5_test'
process.env.DATABASE_URL = testUrl.toString()

const { db, client } = await import('../db')
const schema = await import('../../../db/schema')
const { jobsRoute } = await import('./jobs')

before(async () => {
  await migrate(db, { migrationsFolder: '/app/api/drizzle' })
})
beforeEach(async () => {
  await db.delete(schema.feedbackEvents)
  await db.delete(schema.jobs)
})
after(async () => {
  await db.delete(schema.feedbackEvents)
  await db.delete(schema.jobs)
  await client.end()
})

function app() {
  return new Hono().route('/api/jobs', jobsRoute)
}

test('ingest 按来源 URL 幂等插入和跳过', async () => {
  const payload = { jobs: [{ title: '虚构岗位', company: '虚构公司', source: 'fake', sourceUrl: 'https://example.com/a', description: '虚构 JD', postedAt: '2026-11-24' }] }
  const first = await app().request('/api/jobs/ingest', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })
  assert.equal(first.status, 201)
  assert.deepEqual(await first.json(), { inserted: 1, updated: 0, skipped: 0 })
  const second = await app().request('/api/jobs/ingest', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })
  assert.deepEqual(await second.json(), { inserted: 0, updated: 0, skipped: 1 })
  assert.equal((await db.select().from(schema.jobs)).length, 1)
})

test('ingest 数据库错误只返回脱敏错误码，不泄露 SQL 或岗位 URL', async () => {
  const response = await app().request('/api/jobs/ingest', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jobs: [{ title: '虚构岗位', company: '虚构公司', source: 'fake', sourceUrl: 'https://example.com/invalid-date', description: '虚构 JD', postedAt: '2026-02-30' }] }),
  })
  assert.equal(response.status, 500)
  const body = await response.json()
  assert.equal(body.error, 'JOB_INGEST_FAILED')
  assert.ok(body.code)
  const text = JSON.stringify(body)
  assert.ok(!text.includes('example.com'))
  assert.ok(!text.includes('insert'))
})
