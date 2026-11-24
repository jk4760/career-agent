import { z } from 'zod'
import { modelPrices } from './pricing'

const capabilitiesSchema = z.object({
  streaming: z.boolean().default(false),
  usage: z.boolean().default(false),
  reasoning: z.boolean().default(false),
  jsonSchema: z.boolean().default(false),
})

const catalogEntrySchema = z.object({
  id: z.string().regex(/^[a-z0-9][a-z0-9-_]{0,79}$/),
  label: z.string().trim().min(1).max(80),
  provider: z.string().trim().min(1).max(40),
  model: z.string().trim().min(1).max(120),
  baseUrl: z.string().url(),
  apiKeyEnv: z.string().regex(/^[A-Z][A-Z0-9_]{2,79}$/),
  enabled: z.boolean().default(true),
  maxCompletionTokens: z.number().int().min(1).max(16000).default(2000),
  capabilities: capabilitiesSchema,
})

export type ChatModelCatalogEntry = z.infer<typeof catalogEntrySchema>

function defaultEntry(): ChatModelCatalogEntry {
  const model = process.env.MOONSHOT_MODEL || 'kimi-k3.1-pro'
  return {
    id: 'kimi-default',
    label: model,
    provider: 'moonshot',
    model,
    baseUrl: process.env.MOONSHOT_BASE_URL || 'https://api.moonshot.cn/v1',
    apiKeyEnv: 'MOONSHOT_API_KEY',
    enabled: true,
    maxCompletionTokens: 2000,
    capabilities: { streaming: true, usage: true, reasoning: true, jsonSchema: true },
  }
}

export function modelCatalog(): ChatModelCatalogEntry[] {
  const primary = defaultEntry()
  const raw = process.env.AI_CHAT_MODEL_CATALOG_JSON?.trim()
  if (!raw) return [primary]
  try {
    const entries = z.array(catalogEntrySchema).parse(JSON.parse(raw))
    const seen = new Set([primary.id, primary.model])
    return [
      primary,
      ...entries.filter((entry) => {
        if (seen.has(entry.id) || seen.has(entry.model)) return false
        seen.add(entry.id)
        seen.add(entry.model)
        return true
      }),
    ]
  } catch {
    console.warn('[ai] AI_CHAT_MODEL_CATALOG_JSON 无效，仅使用默认模型')
    return [primary]
  }
}

export function catalogEntry(id: string | undefined): ChatModelCatalogEntry | null {
  const catalog = modelCatalog()
  return id ? (catalog.find((entry) => entry.id === id) ?? null) : catalog[0]
}

export function catalogEntryForConversation(provider: string, model: string): ChatModelCatalogEntry | null {
  const existing = modelCatalog().find((entry) => entry.provider === provider && entry.model === model)
  if (existing) return existing
  if (provider !== 'moonshot') return null
  return { ...defaultEntry(), id: 'kimi-legacy', model }
}

export function assertCatalogEntryUsable(entry: ChatModelCatalogEntry): void {
  if (!entry.enabled) throw new Error('MODEL_DISABLED')
  if (!entry.capabilities.streaming || !entry.capabilities.usage) throw new Error('MODEL_CAPABILITY_UNSUPPORTED')
  if (!process.env[entry.apiKeyEnv]) throw new Error('MODEL_NOT_CONFIGURED')
  if (!modelPrices(entry.model)) throw new Error('MODEL_PRICE_MISSING')
}

export function publicModelCatalog() {
  const defaultId = modelCatalog()[0].id
  return modelCatalog().map((entry) => {
    const configured = Boolean(process.env[entry.apiKeyEnv])
    const priceConfigured = Boolean(modelPrices(entry.model))
    const supported = entry.capabilities.streaming && entry.capabilities.usage
    return {
      id: entry.id,
      label: entry.label,
      provider: entry.provider,
      model: entry.model,
      configured,
      enabled: entry.enabled && supported,
      is_default: entry.id === defaultId,
      capabilities: entry.capabilities,
      priceConfigured,
      disabledReason: !entry.enabled
        ? '模型已禁用'
        : !supported
          ? '不支持当前流式或 usage 能力'
          : !configured
            ? '服务器尚未配置凭据'
            : !priceConfigured
              ? '服务器尚未配置完整价格'
              : null,
    }
  })
}
