import assert from 'node:assert/strict'
import { after, before, beforeEach, test } from 'node:test'
import { eq } from 'drizzle-orm'
import { migrate } from 'drizzle-orm/postgres-js/migrator'

const testUrl = new URL(process.env.DATABASE_URL!)
testUrl.pathname = '/nextcareer_m5_test'
process.env.DATABASE_URL = testUrl.toString()
process.env.MOONSHOT_API_KEY = 'fake-key'
process.env.MOONSHOT_MODEL = 'fake-scoring'
process.env.AI_BUDGET_ENFORCE = 'true'
for (const name of ['INPUT', 'OUTPUT', 'CACHE_HIT', 'CACHE_WRITE_5M', 'CACHE_WRITE_1H']) {
  process.env[`AI_PRICE_FAKE_SCORING_${name}_CNY_PER_MTOK`] = '1'
}

const { scoreJobWithLLM } = await import('./scorer')
const { db, client } = await import('../db')
const schema = await import('../../../db/schema')

const JOB_ID = '00000000-0000-4000-8000-00000000c501'
const JOB = { id: JOB_ID, title: '虚构岗位', company: '虚构公司', location: '上海', salaryMin: null, salaryMax: null, description: '虚构 JD' }
const PREFS = { roles: [], locations: [], salaryMin: null, keywordsInclude: [], keywordsExclude: [], experienceMin: null, backgroundText: '虚构背景' }

before(async () => {
  await migrate(db, { migrationsFolder: '/app/api/drizzle' })
})
beforeEach(async () => {
  await db.delete(schema.modelUsageRequests)
  await db.delete(schema.modelBudgetDays)
  await db.delete(schema.jobs)
  await db.insert(schema.jobs).values({
    id: JOB_ID,
    title: JOB.title,
    company: JOB.company,
    location: JOB.location,
    source: 'fake',
    sourceUrl: 'https://example.com/scoring',
    description: JOB.description,
    dedupKey: 'fake-scoring-job',
  })
  process.env.AI_DAILY_BUDGET_CNY = '2'
})
after(async () => {
  await db.delete(schema.modelUsageRequests)
  await db.delete(schema.modelBudgetDays)
  await client.end()
})

const failureCases = [
  { name: '401', expected: 'HTTP 401', respond: async () => new Response('{"error":"fake"}', { status: 401 }) },
  { name: '429', expected: 'HTTP 429', respond: async () => new Response('{"error":"fake"}', { status: 429 }) },
  { name: '上游 500', expected: 'HTTP 500', respond: async () => new Response('{"error":"fake"}', { status: 500 }) },
  { name: '断网', expected: '调用异常', respond: async () => { throw new TypeError('fake network failure') } },
  { name: '超时', expected: '调用异常', respond: async () => { throw new DOMException('fake timeout', 'TimeoutError') } },
]

for (const failure of failureCases) {
  test(`岗位评分 ${failure.name} 仅请求并结算一次，岗位保持待处理`, async () => {
    let calls = 0
    globalThis.fetch = async () => {
      calls += 1
      return failure.respond()
    }
    const result = await scoreJobWithLLM(JOB, PREFS)
    assert.equal(result.result, null)
    assert.ok(result.error?.includes(failure.expected))
    assert.equal(calls, 1)
    const rows = await db.select().from(schema.modelUsageRequests)
    assert.equal(rows.length, 1)
    assert.equal(rows[0].status, 'conservative')
    assert.equal(rows[0].actualAmount, rows[0].reservedAmount)
    const [job] = await db.select().from(schema.jobs).where(eq(schema.jobs.id, JOB_ID))
    assert.equal(job.llmEval, null)
  })
}

test('预算内评分保持原行为并记录真实 fake usage', async () => {
  globalThis.fetch = async (_input, init) => {
    const body = JSON.parse(String(init?.body))
    assert.equal(body.model, 'fake-scoring')
    assert.equal(body.reasoning_effort, 'low')
    assert.equal(body.max_completion_tokens, 1024)
    return new Response(JSON.stringify({ choices: [{ message: { content: '{"score":91,"reasons":["虚构理由"],"highlight":"虚构看点"}' } }], usage: { prompt_tokens: 100, completion_tokens: 20 } }), { status: 200 })
  }
  const result = await scoreJobWithLLM(JOB, PREFS)
  assert.equal(result.result?.score, 91)
  const rows = await db.select().from(schema.modelUsageRequests)
  assert.equal(rows.length, 1)
  assert.equal(rows[0].status, 'completed')
})

test('预算耗尽停止新调用，岗位保持待处理', async () => {
  process.env.AI_DAILY_BUDGET_CNY = '0'
  let calls = 0
  globalThis.fetch = async () => {
    calls += 1
    throw new Error('不应调用')
  }
  const result = await scoreJobWithLLM(JOB, PREFS)
  assert.equal(result.error, 'BUDGET_EXCEEDED')
  assert.equal(result.result, null)
  assert.equal(calls, 0)
  const [job] = await db.select().from(schema.jobs).where(eq(schema.jobs.id, JOB_ID))
  assert.equal(job.llmEval, null)
})
