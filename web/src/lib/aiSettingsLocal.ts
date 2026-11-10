import type { AISettings } from '@/types'

// AI 对话配置（§7 豁免条款第二条保留）：不走 API，仅存浏览器 localStorage。
// key 带数据结构版本号，版本不匹配/形状不符时自动重置为默认。
const AI_SETTINGS_STORAGE_KEY = 'nextcareer.ai-settings.v1'

const defaultAISettings: AISettings = { baseUrl: '', apiKey: '', models: [] }

export function loadAISettings(): AISettings {
  try {
    const raw = localStorage.getItem(AI_SETTINGS_STORAGE_KEY)
    if (!raw) return defaultAISettings
    const parsed: unknown = JSON.parse(raw)
    if (
      typeof parsed !== 'object' ||
      parsed === null ||
      typeof (parsed as AISettings).baseUrl !== 'string' ||
      typeof (parsed as AISettings).apiKey !== 'string' ||
      !Array.isArray((parsed as AISettings).models)
    ) {
      return defaultAISettings
    }
    return parsed as AISettings
  } catch {
    return defaultAISettings
  }
}

export function saveAISettingsLocal(s: AISettings): AISettings {
  localStorage.setItem(AI_SETTINGS_STORAGE_KEY, JSON.stringify(s))
  return s
}
