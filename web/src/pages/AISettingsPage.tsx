import { useEffect, useState } from 'react'
import { CheckCircle2, Server, XCircle } from 'lucide-react'
import { useRepository } from '@/lib/repository'
import type { AISettings } from '@/types'

export default function AISettingsPage() {
  const repo = useRepository()
  const [settings, setSettings] = useState<AISettings | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    void repo.getAISettings().then(setSettings).catch((err) => {
      setError(err instanceof Error ? err.message : '配置读取失败')
    })
  }, [repo])

  if (!settings) {
    return <p className="text-sm text-muted-foreground">{error ?? '加载中…'}</p>
  }

  return (
    <div className="max-w-2xl space-y-4">
      <div className="rounded-lg border bg-card p-5">
        <div className="flex items-center gap-2">
          <Server className="size-5 text-primary" />
          <h2 className="text-[15px] font-semibold">模型服务</h2>
        </div>
        <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
          AI 对话由后端代理调用。API Key 只保存在服务器环境变量中，不会下发到浏览器，也不再使用本机 localStorage。
        </p>
        <dl className="mt-5 grid gap-4 text-sm sm:grid-cols-2">
          <div>
            <dt className="text-xs text-muted-foreground">服务商</dt>
            <dd className="mt-1 font-medium">Moonshot / Kimi API</dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">当前模型</dt>
            <dd className="mt-1 font-medium break-all">{settings.model}</dd>
          </div>
          <div className="sm:col-span-2">
            <dt className="text-xs text-muted-foreground">接口地址</dt>
            <dd className="mt-1 font-medium break-all">{settings.baseUrl}</dd>
          </div>
        </dl>
        <div className="mt-5 flex items-center gap-2 rounded-md bg-muted px-3 py-2.5 text-sm">
          {settings.configured ? (
            <CheckCircle2 className="size-4 text-status-interested" />
          ) : (
            <XCircle className="size-4 text-destructive" />
          )}
          <span>{settings.configured ? '服务器已配置模型 Key' : '服务器尚未配置模型 Key'}</span>
        </div>
        <p className="mt-3 text-xs text-muted-foreground">
          功能状态：{settings.enabled ? 'AI 对话已启用' : 'AI 对话当前由 feature flag 关闭'}。如需变更模型、Key 或启用状态，请联系服务器管理员修改环境配置。
        </p>
      </div>
    </div>
  )
}
