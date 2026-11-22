export interface ModelPrices {
  input: string
  output: string
  cacheHit: string
  cacheWrite5m: string
  cacheWrite1h: string
}

export interface TokenUsage {
  inputTokens: number
  cacheHitTokens: number
  cacheWriteTokens: number
  outputTokens: number
  cacheTtl: '5m' | '1h'
}

const MONEY_SCALE = 1_000_000n
const TOKENS_PER_MILLION = 1_000_000n

export class BudgetConfigError extends Error {
  readonly code = 'BUDGET_CONFIG_MISSING'
}

export function modelEnvKey(model: string): string {
  return model.replace(/[^A-Za-z0-9]/g, '_').replace(/_/g, '_').toUpperCase()
}

export function modelPrices(model: string, env: NodeJS.ProcessEnv = process.env): ModelPrices | null {
  const key = modelEnvKey(model)
  const read = (name: string) => env[`AI_PRICE_${key}_${name}_CNY_PER_MTOK`]?.trim()
  const prices = {
    input: read('INPUT'),
    output: read('OUTPUT'),
    cacheHit: read('CACHE_HIT'),
    cacheWrite5m: read('CACHE_WRITE_5M'),
    cacheWrite1h: read('CACHE_WRITE_1H'),
  }
  return Object.values(prices).every(Boolean) ? (prices as ModelPrices) : null
}

function decimalToScaled(value: string): bigint {
  const match = value.trim().match(/^(\d+)(?:\.(\d+))?$/)
  if (!match) throw new BudgetConfigError(`非法价格配置: ${value}`)
  const fraction = (match[2] ?? '').padEnd(6, '0')
  if (fraction.length > 6) throw new BudgetConfigError(`价格最多支持 6 位小数: ${value}`)
  return BigInt(match[1]) * MONEY_SCALE + BigInt(fraction || '0')
}

function tokenCost(tokens: number, price: string, roundUp: boolean): bigint {
  if (!Number.isInteger(tokens) || tokens < 0) throw new Error('token 数量必须是非负整数')
  const numerator = BigInt(tokens) * decimalToScaled(price)
  const quotient = numerator / TOKENS_PER_MILLION
  const remainder = numerator % TOKENS_PER_MILLION
  if (roundUp && remainder > 0n) return quotient + 1n
  return quotient + (remainder * 2n >= TOKENS_PER_MILLION ? 1n : 0n)
}

export function microsToCny(value: bigint): string {
  const negative = value < 0n
  const absolute = negative ? -value : value
  const integer = absolute / MONEY_SCALE
  const fraction = (absolute % MONEY_SCALE).toString().padStart(6, '0')
  return `${negative ? '-' : ''}${integer}.${fraction}`
}

export function cnyToMicros(value: string): bigint {
  return decimalToScaled(value)
}

export function reserveMicros(
  estimatedInputTokens: number,
  maxCompletionTokens: number,
  cacheTtl: '5m' | '1h',
  prices: ModelPrices,
): bigint {
  return (
    tokenCost(estimatedInputTokens, prices.input, true) +
    tokenCost(estimatedInputTokens, cacheTtl === '1h' ? prices.cacheWrite1h : prices.cacheWrite5m, true) +
    tokenCost(maxCompletionTokens, prices.output, true)
  )
}

export function actualMicros(usage: TokenUsage, prices: ModelPrices): bigint {
  return (
    tokenCost(usage.inputTokens, prices.input, false) +
    tokenCost(usage.cacheHitTokens, prices.cacheHit, false) +
    tokenCost(
      usage.cacheWriteTokens,
      usage.cacheTtl === '1h' ? prices.cacheWrite1h : prices.cacheWrite5m,
      false,
    ) +
    tokenCost(usage.outputTokens, prices.output, false)
  )
}

export function estimateTokens(value: string): number {
  let ascii = 0
  let other = 0
  for (const char of value) {
    if (char.codePointAt(0)! <= 0x7f) ascii += 1
    else other += 1
  }
  return Math.ceil(ascii / 3) + other + 16
}

export function budgetLimitMicros(env: NodeJS.ProcessEnv = process.env): bigint {
  return cnyToMicros(env.AI_DAILY_BUDGET_CNY?.trim() || '2')
}

export function budgetEnforced(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.AI_BUDGET_ENFORCE?.trim().toLowerCase() === 'true'
}
