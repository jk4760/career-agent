import { randomUUID } from 'node:crypto'
import { desc, eq, sql } from 'drizzle-orm'
import { modelBudgetAlerts, modelBudgetDays, modelUsageRequests } from '../../../db/schema'
import { db } from '../db'
import {
  BudgetConfigError,
  actualMicros,
  budgetEnforced,
  budgetLimitMicros,
  cnyToMicros,
  microsToCny,
  modelPrices,
  reserveMicros,
  type TokenUsage,
} from './pricing'

export type ModelPurpose = 'job_scoring' | 'chat' | 'resume_strategy' | 'other'

export interface ReserveInput {
  purpose: ModelPurpose
  provider: string
  model: string
  estimatedInputTokens: number
  maxCompletionTokens: number
  cacheTtl?: '5m' | '1h'
  businessId?: string
  requestId?: string
}

export interface Reservation {
  requestId: string
  reservedMicros: bigint
}

export class BudgetExceededError extends Error {
  readonly code = 'BUDGET_EXCEEDED'
}

export function shanghaiDate(now = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now)
}

function settledMicros(row: typeof modelUsageRequests.$inferSelect): bigint {
  const value =
    row.status === 'reserved' || row.status === 'running'
      ? row.reservedAmount
      : (row.actualAmount ?? row.reservedAmount)
  const [integer, fraction = ''] = value.split('.')
  return BigInt(integer) * 1_000_000n + BigInt(fraction.padEnd(6, '0').slice(0, 6))
}

async function totalsForDate(
  date: string,
  executor: Pick<typeof db, 'select'> = db,
): Promise<{ spentMicros: bigint; reservedMicros: bigint; totalMicros: bigint }> {
  const rows = await executor
    .select()
    .from(modelUsageRequests)
    .where(eq(modelUsageRequests.budgetDate, date))
  let spentMicros = 0n
  let reservedMicros = 0n
  for (const row of rows) {
    const amount = settledMicros(row)
    if (row.status === 'reserved' || row.status === 'running') reservedMicros += amount
    else spentMicros += amount
  }
  return { spentMicros, reservedMicros, totalMicros: spentMicros + reservedMicros }
}

async function reserveModelCallAtomic(input: ReserveInput): Promise<Reservation> {
  const prices = modelPrices(input.model)
  if (budgetEnforced() && !prices) {
    throw new BudgetConfigError(`模型 ${input.model} 缺少完整价格配置`)
  }
  const cacheTtl = input.cacheTtl ?? '5m'
  const reservedMicros = prices
    ? reserveMicros(input.estimatedInputTokens, input.maxCompletionTokens, cacheTtl, prices)
    : 0n
  const requestId = input.requestId ?? randomUUID()
  const date = shanghaiDate()

  const reservedAmount = microsToCny(reservedMicros)
  await db.insert(modelBudgetDays).values({ budgetDate: date }).onConflictDoNothing()
  const allowed = budgetEnforced()
    ? sql`${modelBudgetDays.totalAmount} + ${reservedAmount}::numeric <= ${microsToCny(budgetLimitMicros())}::numeric`
    : sql`true`
  const inserted = await db.execute(sql`
    WITH accepted AS (
      UPDATE model_budget_days
      SET total_amount = total_amount + ${reservedAmount}::numeric
      WHERE budget_date = ${date} AND ${allowed}
      RETURNING budget_date
    )
    INSERT INTO model_usage_requests (
      request_id, budget_date, purpose, provider, model, status,
      estimated_input_tokens, max_completion_tokens, reserved_amount, cache_ttl, business_id
    )
    SELECT
      ${requestId}::uuid, ${date}, ${input.purpose}, ${input.provider}, ${input.model}, 'reserved',
      ${input.estimatedInputTokens}, ${input.maxCompletionTokens}, ${reservedAmount}::numeric,
      ${cacheTtl}, ${input.businessId}
    FROM accepted
    RETURNING request_id
  `)
  if (!inserted.length) throw new BudgetExceededError('今日模型预算已用完')
  return { requestId, reservedMicros }
}

let reservationQueue: Promise<void> = Promise.resolve()

export function reserveModelCall(input: ReserveInput): Promise<Reservation> {
  const result = reservationQueue.then(() => reserveModelCallAtomic(input))
  reservationQueue = result.then(
    () => undefined,
    () => undefined,
  )
  return result
}

export async function markModelCallRunning(requestId: string): Promise<void> {
  await db
    .update(modelUsageRequests)
    .set({ status: 'running', startedAt: new Date() })
    .where(eq(modelUsageRequests.requestId, requestId))
}

async function adjustBudgetDay(date: string, deltaMicros: bigint): Promise<void> {
  const delta = microsToCny(deltaMicros)
  await db
    .update(modelBudgetDays)
    .set({ totalAmount: sql`${modelBudgetDays.totalAmount} + ${delta}::numeric` })
    .where(eq(modelBudgetDays.budgetDate, date))
}

export async function releaseModelCall(requestId: string): Promise<void> {
  const [row] = await db.select().from(modelUsageRequests).where(eq(modelUsageRequests.requestId, requestId))
  if (!row) return
  await db
    .update(modelUsageRequests)
    .set({ status: 'failed', actualAmount: '0', finishedAt: new Date(), errorCode: 'NOT_SENT' })
    .where(eq(modelUsageRequests.requestId, requestId))
  await adjustBudgetDay(row.budgetDate, -cnyToMicros(row.reservedAmount))
}

export async function settleModelCall(input: {
  requestId: string
  usage: TokenUsage | null
  errorCode?: string
  failed?: boolean
}): Promise<void> {
  const [row] = await db
    .select()
    .from(modelUsageRequests)
    .where(eq(modelUsageRequests.requestId, input.requestId))
  if (!row || (row.status !== 'reserved' && row.status !== 'running')) return
  const prices = modelPrices(row.model)
  const actual = input.usage && prices ? actualMicros(input.usage, prices) : cnyToMicros(row.reservedAmount)
  await db
    .update(modelUsageRequests)
    .set({
      status: input.usage && prices ? (input.failed ? 'failed' : 'completed') : 'conservative',
      inputTokens: input.usage?.inputTokens,
      cacheHitTokens: input.usage?.cacheHitTokens,
      cacheWriteTokens: input.usage?.cacheWriteTokens,
      outputTokens: input.usage?.outputTokens,
      cacheTtl: input.usage?.cacheTtl ?? row.cacheTtl,
      actualAmount: microsToCny(BigInt(actual)),
      finishedAt: new Date(),
      errorCode: input.errorCode,
    })
    .where(eq(modelUsageRequests.requestId, input.requestId))
  await adjustBudgetDay(row.budgetDate, BigInt(actual) - cnyToMicros(row.reservedAmount))
  await maybeBudgetAlert(row.budgetDate)
}

export async function getBudgetStatus(date = shanghaiDate()) {
  const totals = await totalsForDate(date)
  const limit = budgetLimitMicros()
  return {
    date,
    spentCny: microsToCny(totals.spentMicros),
    reservedCny: microsToCny(totals.reservedMicros),
    totalCny: microsToCny(totals.totalMicros),
    limitCny: microsToCny(limit),
    percent: Number((totals.totalMicros * 10000n) / limit) / 100,
    exhausted: budgetEnforced() && totals.totalMicros >= limit,
    enforce: budgetEnforced(),
  }
}

async function maybeBudgetAlert(date: string): Promise<void> {
  const status = await getBudgetStatus(date)
  if (status.percent < 100 || !status.enforce) return
  const [inserted] = await db
    .insert(modelBudgetAlerts)
    .values({ budgetDate: date, threshold: 100 })
    .onConflictDoNothing()
    .returning({ id: modelBudgetAlerts.id })
  if (!inserted) return
  const { sendAlert } = await import('../push')
  await sendAlert(`今日模型估算费用已达到 ¥${status.limitCny}，新的模型调用已暂停`)
}

export async function listRecentModelUsage(limit = 20) {
  return db
    .select({
      requestId: modelUsageRequests.requestId,
      purpose: modelUsageRequests.purpose,
      model: modelUsageRequests.model,
      status: modelUsageRequests.status,
      actualAmount: modelUsageRequests.actualAmount,
      reservedAmount: modelUsageRequests.reservedAmount,
      createdAt: modelUsageRequests.createdAt,
    })
    .from(modelUsageRequests)
    .orderBy(desc(modelUsageRequests.createdAt))
    .limit(limit)
}

export function usageFromOpenAI(payload: unknown): TokenUsage | null {
  const usage = (payload as { usage?: Record<string, unknown> })?.usage
  if (!usage) return null
  const totalInput = Number(usage.prompt_tokens)
  const outputTokens = Number(usage.completion_tokens)
  if (!Number.isFinite(totalInput) || !Number.isFinite(outputTokens)) return null
  const details = (usage.prompt_tokens_details ?? {}) as Record<string, unknown>
  const cacheHitTokens = Number(details.cached_tokens ?? usage.cached_tokens ?? 0)
  const cacheCreation = (usage.cache_creation ?? {}) as Record<string, unknown>
  const write5m = Number(
    usage.cache_creation_input_tokens ??
      usage.prompt_cache_creation_tokens ??
      cacheCreation.ephemeral_5m_input_tokens ??
      0,
  )
  const write1h = Number(cacheCreation.ephemeral_1h_input_tokens ?? 0)
  const cacheWriteTokens = write5m + write1h
  return {
    inputTokens: Math.max(0, Math.round(totalInput - cacheHitTokens - cacheWriteTokens)),
    cacheHitTokens: Math.max(0, Math.round(cacheHitTokens)),
    cacheWriteTokens: Math.max(0, Math.round(cacheWriteTokens)),
    outputTokens: Math.max(0, Math.round(outputTokens)),
    cacheTtl: write1h > 0 ? '1h' : '5m',
  }
}
