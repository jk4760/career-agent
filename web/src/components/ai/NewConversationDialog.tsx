import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import type { AIModelCatalogItem } from '@/types'

interface Props {
  open: boolean
  catalog: AIModelCatalogItem[]
  onCancel: () => void
  onCreate: (catalogId: string) => Promise<void>
}

export function NewConversationDialog({ open, catalog, onCancel, onCreate }: Props) {
  const [selectedId, setSelectedId] = useState('')
  const [creating, setCreating] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    setSelectedId(catalog.find((item) => item.is_default)?.id ?? catalog[0]?.id ?? '')
    setCreating(false)
    setError(null)
  }, [open, catalog])

  const selected = catalog.find((item) => item.id === selectedId)
  const unavailable = selected && (!selected.enabled || !selected.configured || !selected.priceConfigured)

  const create = async () => {
    if (!selected || unavailable) return
    setCreating(true)
    setError(null)
    try {
      await onCreate(selected.id)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '创建会话失败')
    } finally {
      setCreating(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => { if (!nextOpen && !creating) onCancel() }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>新建会话</DialogTitle>
          <DialogDescription>选择本次对话使用的模型。创建后模型固定，既有会话不受影响。</DialogDescription>
        </DialogHeader>
        <div className="space-y-2" role="radiogroup" aria-label="可用模型">
          {catalog.map((item) => {
            const disabled = !item.enabled || !item.configured || !item.priceConfigured
            return (
              <label
                key={item.id}
                className={`flex min-h-14 cursor-pointer items-start gap-3 rounded-md border px-3 py-2.5 text-sm ${selectedId === item.id ? 'border-primary bg-accent' : 'bg-card'} ${disabled ? 'cursor-not-allowed opacity-60' : ''}`}
              >
                <input
                  type="radio"
                  name="conversation-model"
                  className="mt-1 size-4 shrink-0 accent-[#2563eb]"
                  value={item.id}
                  checked={selectedId === item.id}
                  disabled={disabled || creating}
                  onChange={() => setSelectedId(item.id)}
                />
                <span className="min-w-0 flex-1">
                  <span className="flex flex-wrap items-center gap-2 font-medium">
                    {item.label}
                    {item.is_default && <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-normal text-muted-foreground">默认</span>}
                  </span>
                  <span className="mt-0.5 block text-xs text-muted-foreground">{item.provider} / {item.model}</span>
                  {item.disabledReason && <span className="mt-0.5 block text-xs text-amber-700">{item.disabledReason}</span>}
                </span>
              </label>
            )
          })}
        </div>
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        <DialogFooter>
          <Button variant="outline" disabled={creating} onClick={onCancel}>取消</Button>
          <Button disabled={!selected || unavailable || creating} onClick={() => void create()}>{creating ? '创建中…' : '创建会话'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
