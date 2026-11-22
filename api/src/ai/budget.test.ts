import assert from 'node:assert/strict'
import { after, afterEach, before, test } from 'node:test'
import { eq, like } from 'drizzle-orm'

process.env.DATABASE_URL ??= 'postgres://test:test@localhost:5432/test'
process.env.AI_BUDGET_ENFORCE = 'true'
process.env.AI_DAILY_BUDGET_CNY = '2'
for (const name of ['INPUT', 'OUTPUT', 'CACHE_HIT', 'CACHE_WRITE_5M', 'CACHE_WRITE_1H']) {
  process.env[`AI_PRICE_FAKE_BUDGET_${name}_CNY_PER_MTOK`] = '1'
}
process.env.FEISHU_ALERT_CHANNEL = 'webhook'
process.env.FEISHU_WEBHOOK_URL = ''

const { actualMicros, cnyToMicros, microsToCny, reserveMicros } = await import('./pricing')
const {
  getBudgetStatus,
  reserveModelCall,
  settleModelCall,
  shanghaiDate,
} = await import('./budget')
const { db, client } = await import('../db')
const { modelBudgetAlerts, modelBudgetDays, modelUsageRequests } = await import('../../../db/schema')

const TEST_MARK = 'm5-budget-test-%'
const FAKE_PRICES = { input: '1', output: '1', cacheHit: '1', cacheWrite5m: '1', cacheWrite1h: '1' }

async function cleanup() {
  await db.delete(modelUsageRequests).where(like(modelUsageRequests.businessId, TEST_MARK))
  await db.delete(modelBudgetAlerts).where(eq(modelBudgetAlerts.budgetDate, shanghaiDate()))
  await db.delete(modelBudgetDays).where(eq(modelBudgetDays.budgetDate, shanghaiDate()))
}

before(cleanup)
afterEach(cleanup)
after(async () => {
  await cleanup()
  await client.end()
})

test('价格换算使用整数微元，不发生浮点累计误差', () => {
  assert.equal(cnyToMicros('0.1') + cnyToMicros('0.2'), cnyToMicros('0.3'))
  assert.equal(microsToCny(cnyToMicros('13.30')), '13.300000')
  assert.equal(actualMicros({ inputTokens: 1, cacheHitTokens: 0, cacheWriteTokens: 0, outputTokens: 1, cacheTtl: '5m' }, FAKE_PRICES), 2n)
})

test('预留覆盖普通输入、缓存写入和最大输出，实际结算分类计算', () => {
  const reserved = reserveMicros(1000, 2000, '5m', FAKE_PRICES)
  assert.equal(reserved, 4000n)
  const actual = actualMicros(
    { inputTokens: 100, cacheHitTokens: 200, cacheWriteTokens: 300, outputTokens: 400, cacheTtl: '5m' },
    FAKE_PRICES,
  )
  assert.equal(actual, 1000n)
  const oneHour = actualMicros(
    { inputTokens: 0, cacheHitTokens: 0, cacheWriteTokens: 1000, outputTokens: 0, cacheTtl: '1h' },
    { ...FAKE_PRICES, cacheWrite1h: '2' },
  )
  assert.equal(oneHour, 2000n)
})

test('2 元边界恰好允许，超出拒绝，并发请求不能同时越过预算', async () => {
  const status = await getBudgetStatus()
  const remaining = cnyToMicros(status.limitCny) - cnyToMicros(status.totalCny)
  const base = await reserveModelCall({
    purpose: 'other', provider: 'fake', model: 'fake-budget', estimatedInputTokens: 0,
    maxCompletionTokens: Number(remaining - 100n), businessId: 'm5-budget-test-base',
  })
  const attempts = await Promise.allSettled([
    reserveModelCall({ purpose: 'other', provider: 'fake', model: 'fake-budget', estimatedInputTokens: 0, maxCompletionTokens: 100, businessId: 'm5-budget-test-concurrent-a' }),
    reserveModelCall({ purpose: 'other', provider: 'fake', model: 'fake-budget', estimatedInputTokens: 0, maxCompletionTokens: 100, businessId: 'm5-budget-test-concurrent-b' }),
  ])
  assert.equal(attempts.filter((result) => result.status === 'fulfilled').length, 1)
  assert.equal(attempts.filter((result) => result.status === 'rejected').length, 1)
  await db.delete(modelUsageRequests).where(eq(modelUsageRequests.requestId, base.requestId))
})

test('真实 usage 结算释放多余预留，usage 缺失按预留保守结算', async () => {
  const first = await reserveModelCall({ purpose: 'other', provider: 'fake', model: 'fake-budget', estimatedInputTokens: 1000, maxCompletionTokens: 1000, businessId: 'm5-budget-test-settle' })
  await settleModelCall({ requestId: first.requestId, usage: { inputTokens: 100, cacheHitTokens: 0, cacheWriteTokens: 0, outputTokens: 100, cacheTtl: '5m' } })
  const [settled] = await db.select().from(modelUsageRequests).where(eq(modelUsageRequests.requestId, first.requestId))
  assert.equal(settled.actualAmount, '0.000200')
  assert.ok(cnyToMicros(settled.actualAmount) < cnyToMicros(settled.reservedAmount))

  const second = await reserveModelCall({ purpose: 'other', provider: 'fake', model: 'fake-budget', estimatedInputTokens: 1000, maxCompletionTokens: 1000, businessId: 'm5-budget-test-conservative' })
  await settleModelCall({ requestId: second.requestId, usage: null, failed: true, errorCode: 'TEST' })
  const [conservative] = await db.select().from(modelUsageRequests).where(eq(modelUsageRequests.requestId, second.requestId))
  assert.equal(conservative.actualAmount, conservative.reservedAmount)
  assert.equal(conservative.status, 'conservative')
})

test('Asia/Shanghai 自然日跨日重置', () => {
  assert.equal(shanghaiDate(new Date('2026-11-19T15:59:59Z')), '2026-11-19')
  assert.equal(shanghaiDate(new Date('2026-11-19T16:00:00Z')), '2026-11-20')
})

test('80% 不单独告警，100% 每日最多记录一次告警', async () => {
  const date = shanghaiDate()
  let status = await getBudgetStatus(date)
  const to80 = cnyToMicros(status.limitCny) * 80n / 100n - cnyToMicros(status.totalCny)
  const first = await reserveModelCall({ purpose: 'other', provider: 'fake', model: 'fake-budget', estimatedInputTokens: 0, maxCompletionTokens: Number(to80), businessId: 'm5-budget-test-80' })
  await settleModelCall({ requestId: first.requestId, usage: { inputTokens: 0, cacheHitTokens: 0, cacheWriteTokens: 0, outputTokens: Number(to80), cacheTtl: '5m' } })
  assert.equal((await db.select().from(modelBudgetAlerts).where(eq(modelBudgetAlerts.budgetDate, date))).length, 0)

  status = await getBudgetStatus(date)
  const to100 = cnyToMicros(status.limitCny) - cnyToMicros(status.totalCny)
  const second = await reserveModelCall({ purpose: 'other', provider: 'fake', model: 'fake-budget', estimatedInputTokens: 0, maxCompletionTokens: Number(to100), businessId: 'm5-budget-test-100' })
  await settleModelCall({ requestId: second.requestId, usage: { inputTokens: 0, cacheHitTokens: 0, cacheWriteTokens: 0, outputTokens: Number(to100), cacheTtl: '5m' } })
  await settleModelCall({ requestId: second.requestId, usage: { inputTokens: 0, cacheHitTokens: 0, cacheWriteTokens: 0, outputTokens: Number(to100), cacheTtl: '5m' } })
  assert.equal((await db.select().from(modelBudgetAlerts).where(eq(modelBudgetAlerts.budgetDate, date))).length, 1)
})
