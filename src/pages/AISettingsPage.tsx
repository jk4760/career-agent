import { useEffect, useState } from 'react'
import { X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useRepository } from '@/lib/repository'
import type { AISettings } from '@/types'

/**
 * AI 对话管理（§6.7，`/ai-settings`）：单个 OpenAI 兼容服务配置
 * { baseUrl, apiKey, models }，localStorage 持久化（§7 豁免条款第二条）。
 * 保存后对话面板模型下拉立即联动更新。
 */
export default function AISettingsPage() {
  const repo = useRepository()
  const [settings, setSettings] = useState<AISettings | null>(null)
  const [baseUrl, setBaseUrl] = useState('')
  const [apiKey, setApiKey] = useState('')
  const [models, setModels] = useState<string[]>([])
  const [modelInput, setModelInput] = useState('')
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    void repo.getAISettings().then((s) => {
      setSettings(s)
      setBaseUrl(s.baseUrl)
      setApiKey(s.apiKey)
      setModels(s.models)
    })
  }, [repo])

  if (!settings) {
    return <p className="text-sm text-muted-foreground">加载中…</p>
  }

  const addModel = () => {
    const v = modelInput.trim()
    if (!v) return
    if (!models.includes(v)) setModels([...models, v])
    setModelInput('')
    setSaved(false)
  }

  const handleSave = async () => {
    await repo.saveAISettings({ baseUrl: baseUrl.trim(), apiKey: apiKey.trim(), models })
    setSaved(true)
  }

  return (
    <div className="max-w-xl space-y-4">
      <div className="space-y-4 rounded-lg border bg-card p-4 sm:p-6">
        <div>
          <h2 className="text-[15px] font-semibold">模型服务（OpenAI 兼容接口）</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            密钥仅保存在本机浏览器，M5 起由后端代理调用。
          </p>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="ai-base-url">API 地址</Label>
          <Input
            id="ai-base-url"
            placeholder="https://api.moonshot.cn/v1"
            value={baseUrl}
            onChange={(e) => {
              setBaseUrl(e.target.value)
              setSaved(false)
            }}
          />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="ai-api-key">API Key</Label>
          <Input
            id="ai-api-key"
            type="password"
            placeholder="sk-..."
            autoComplete="off"
            value={apiKey}
            onChange={(e) => {
              setApiKey(e.target.value)
              setSaved(false)
            }}
          />
          <p className="text-xs text-muted-foreground">仅本机存储，不提交任何服务器。</p>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="ai-models">模型列表</Label>
          <div className="flex min-h-8 w-full flex-wrap items-center gap-1.5 rounded-md border border-input bg-white px-2 py-1.5 focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/50">
            {models.map((m) => (
              <span
                key={m}
                className="flex items-center gap-1 rounded bg-accent px-1.5 py-0.5 text-xs text-accent-foreground"
              >
                {m}
                <button
                  type="button"
                  aria-label={`删除模型 ${m}`}
                  className="cursor-pointer"
                  onClick={() => {
                    setModels(models.filter((x) => x !== m))
                    setSaved(false)
                  }}
                >
                  <X className="size-3" />
                </button>
              </span>
            ))}
            <input
              id="ai-models"
              className="min-w-24 flex-1 bg-transparent text-sm outline-none"
              placeholder={models.length === 0 ? '输入模型名，回车添加' : ''}
              value={modelInput}
              onChange={(e) => setModelInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.nativeEvent.isComposing) return
                if (e.key === 'Enter') {
                  e.preventDefault()
                  addModel()
                } else if (e.key === 'Backspace' && !modelInput && models.length > 0) {
                  setModels(models.slice(0, -1))
                  setSaved(false)
                }
              }}
              onBlur={addModel}
            />
          </div>
          <p className="text-xs text-muted-foreground">对话面板的模型下拉即来源于此。</p>
        </div>

        <div className="flex items-center gap-3">
          <Button onClick={handleSave}>保存</Button>
          {saved ? (
            <span className="text-sm font-medium text-status-interested">已保存</span>
          ) : null}
          <span className="text-xs text-muted-foreground">
            保存后对话面板的模型下拉立即更新
          </span>
        </div>
      </div>
    </div>
  )
}
