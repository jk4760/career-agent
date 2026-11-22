import { useEffect, useMemo, useRef, useState } from 'react'
import { ChevronRight, FolderOpen, Search, X } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { estimateAIContext } from '@/lib/aiApi'
import { useRepository } from '@/lib/repository'
import { cn } from '@/lib/utils'
import type { AIContextEstimate, AIContextSelection, Material, Preferences } from '@/types'

interface Props {
  open: boolean
  selection: AIContextSelection
  startPreview?: boolean
  onCancel: () => void
  onApply: (selection: AIContextSelection) => Promise<void>
}

export function ContextSelector({ open, selection, startPreview = false, onCancel, onApply }: Props) {
  const repo = useRepository()
  const navigate = useNavigate()
  const [draft, setDraft] = useState(selection)
  const [materials, setMaterials] = useState<Material[]>([])
  const [prefs, setPrefs] = useState<Preferences | null>(null)
  const [estimate, setEstimate] = useState<AIContextEstimate | null>(null)
  const [search, setSearch] = useState('')
  const [preview, setPreview] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const closeRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (!open) return
    setDraft(selection)
    setSearch('')
    setPreview(startPreview)
    setError(null)
    void Promise.all([repo.listMaterials(), repo.getPreferences()]).then(([ms, p]) => {
      setMaterials(ms)
      setPrefs(p)
    })
    closeRef.current?.focus()
  }, [open, repo, selection, startPreview])

  useEffect(() => {
    if (!open) return
    const timer = setTimeout(() => {
      void estimateAIContext(draft).then(setEstimate).catch((err) => {
        setError(err instanceof Error ? err.message : '字数预估失败')
      })
    }, 160)
    return () => clearTimeout(timer)
  }, [draft, open])

  useEffect(() => {
    if (!open) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onCancel()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [onCancel, open])

  const visibleMaterials = useMemo(() => {
    const query = search.trim().toLowerCase()
    return materials
      .filter((material) => {
        if (!query) return true
        return [material.title, material.project, ...material.tags, ...material.facets]
          .join(' ')
          .toLowerCase()
          .includes(query)
      })
      .sort((a, b) => Number(draft.materialIds.includes(b.id)) - Number(draft.materialIds.includes(a.id)))
  }, [draft.materialIds, materials, search])

  if (!open) return null

  const toggleMaterial = (id: string) => {
    setError(null)
    setDraft((current) => {
      if (current.materialIds.includes(id)) {
        return { ...current, materialIds: current.materialIds.filter((item) => item !== id) }
      }
      if (current.materialIds.length >= 3) {
        setError('最多选择 3 个素材，请先取消一个已选项')
        return current
      }
      return { ...current, materialIds: [...current.materialIds, id] }
    })
  }

  const apply = async () => {
    if (estimate?.exceeds) return
    setSaving(true)
    setError(null)
    try {
      await onApply(draft)
    } catch (err) {
      setError(err instanceof Error ? err.message : '保存失败，请重试')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-[70] bg-slate-900/20" onMouseDown={onCancel}>
      <section
        role="dialog"
        aria-modal="true"
        aria-label="本次上下文"
        className="absolute inset-x-0 bottom-0 flex max-h-[88vh] flex-col rounded-t-lg border bg-white shadow-xl md:inset-x-auto md:top-16 md:right-4 md:bottom-auto md:h-auto md:w-[400px] md:rounded-lg"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="mx-auto mt-2 h-1 w-10 rounded-full bg-slate-200 md:hidden" />
        <header className="flex items-start justify-between border-b px-4 py-3">
          <div>
            <h2 className="text-sm font-semibold">{preview ? '本次将携带的内容' : '本次上下文'}</h2>
            <p className="mt-0.5 text-xs text-muted-foreground">仅用于当前会话，不修改全局设置</p>
          </div>
          <Button ref={closeRef} variant="ghost" size="icon-sm" aria-label="关闭" onClick={onCancel}>
            <X />
          </Button>
        </header>

        {preview ? (
          <div className="flex-1 space-y-4 overflow-y-auto p-4">
            {(estimate?.segments ?? []).length === 0 ? (
              <p className="py-10 text-center text-sm text-muted-foreground">当前没有选择资料</p>
            ) : (
              estimate?.segments.map((segment) => (
                <section key={`${segment.sourceType}-${segment.sourceId}`}>
                  <h3 className="mb-1.5 text-xs font-semibold text-muted-foreground">{segment.name}</h3>
                  <p className="max-h-48 overflow-y-auto whitespace-pre-wrap rounded-md bg-muted p-3 text-xs leading-relaxed text-slate-700">
                    {segment.content}
                  </p>
                </section>
              ))
            )}
          </div>
        ) : (
          <div className="flex-1 space-y-4 overflow-y-auto p-4">
            <label className="flex min-h-11 cursor-pointer items-start gap-3 rounded-md border px-3 py-2.5">
              <input
                type="checkbox"
                className="mt-0.5 size-4 accent-[#2563eb]"
                checked={draft.includePreferences}
                onChange={(event) => setDraft({ ...draft, includePreferences: event.target.checked })}
              />
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-medium">求职偏好</span>
                <span className="mt-0.5 block truncate text-xs text-muted-foreground">
                  {[prefs?.roles.join('、'), prefs?.locations.join('、')].filter(Boolean).join(' · ') || '读取中…'}
                </span>
              </span>
              <button type="button" className="text-xs text-primary" onClick={() => setPreview(true)}>查看</button>
            </label>

            <label className="flex min-h-11 cursor-pointer items-start gap-3 rounded-md border px-3 py-2.5">
              <input
                type="checkbox"
                className="mt-0.5 size-4 accent-[#2563eb]"
                checked={draft.resumeId !== null}
                onChange={(event) => setDraft({ ...draft, resumeId: event.target.checked ? (prefs?.id ?? null) : null })}
              />
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-medium">当前简历</span>
                <span className="mt-0.5 block truncate text-xs text-muted-foreground">
                  个人背景 · {prefs?.updatedAt.slice(0, 10) ?? '读取中…'}
                </span>
              </span>
              <button type="button" className="text-xs text-primary" onClick={() => setPreview(true)}>查看</button>
            </label>

            <div>
              <div className="mb-2 flex items-center justify-between">
                <h3 className="text-sm font-medium">素材故事</h3>
                <span className="text-xs text-muted-foreground tabular-nums">
                  已选 {draft.materialIds.length}/{materials.length} · 最多 3 个 · 已选优先
                </span>
              </div>
              {materials.length > 0 && (
                <div className="relative mb-2">
                  <Search className="absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    className="pl-8"
                    placeholder="搜索标题、项目或标签"
                    value={search}
                    onChange={(event) => setSearch(event.target.value)}
                  />
                </div>
              )}
              <div className="max-h-52 space-y-1 overflow-y-auto">
                {materials.length === 0 ? (
                  <div className="flex flex-col items-center gap-2 rounded-md border border-dashed px-3 py-7 text-center">
                    <FolderOpen className="size-5 text-muted-foreground" />
                    <p className="text-sm font-medium">还没有素材故事</p>
                    <p className="text-xs text-muted-foreground">可先使用偏好和简历继续对话</p>
                    <Button variant="link" size="sm" onClick={() => navigate('/materials')}>
                      前往素材库 <ChevronRight />
                    </Button>
                  </div>
                ) : visibleMaterials.length === 0 ? (
                  <div className="py-6 text-center text-xs text-muted-foreground">
                    没有匹配的素材
                    <Button variant="link" size="sm" onClick={() => setSearch('')}>清除搜索</Button>
                  </div>
                ) : (
                  visibleMaterials.map((material) => (
                    <label
                      key={material.id}
                      className={cn(
                        'flex min-h-11 cursor-pointer items-center gap-2.5 rounded-md px-2.5 py-2 hover:bg-muted',
                        draft.materialIds.includes(material.id) && 'bg-accent',
                      )}
                    >
                      <input
                        type="checkbox"
                        className="size-4 shrink-0 accent-[#2563eb]"
                        checked={draft.materialIds.includes(material.id)}
                        onChange={() => toggleMaterial(material.id)}
                      />
                      <span className="min-w-0">
                        <span className="block truncate text-xs font-medium">{material.title}</span>
                        <span className="block truncate text-[11px] text-muted-foreground">
                          {material.project} · {material.facets.join(' / ') || '无标签'}
                        </span>
                      </span>
                    </label>
                  ))
                )}
              </div>
            </div>
            {estimate?.exceeds && (
              <div className="rounded-md border border-red-200 bg-red-50 p-3 text-xs text-red-700">
                <p>上下文内容超限 · 预计 {estimate.totalChars} 字／上限 {estimate.limitChars} 字</p>
                <div className="mt-2 h-1 overflow-hidden rounded bg-red-100">
                  <div className="h-full bg-red-500" style={{ width: `${Math.min(100, (estimate.totalChars / estimate.limitChars) * 100)}%` }} />
                </div>
                <p className="mt-1.5">请取消部分素材后再应用，内容不会自动截断。</p>
              </div>
            )}
            {error && <p className="text-xs text-destructive">{error}</p>}
          </div>
        )}

        <footer className="border-t px-4 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
          <div className="mb-2 flex items-center justify-between text-xs text-muted-foreground">
            <span>仅当前会话生效</span>
            <span className="tabular-nums">预计 {estimate?.totalChars ?? 0} 字</span>
          </div>
          <div className="flex justify-end gap-2">
            {preview ? (
              <>
                <Button variant="outline" onClick={() => setPreview(false)}>返回对话</Button>
                <Button onClick={() => setPreview(false)}>修改选择</Button>
              </>
            ) : (
              <>
                <Button variant="outline" onClick={onCancel}>取消</Button>
                <Button onClick={apply} disabled={saving || estimate?.exceeds}>
                  {saving ? '保存中…' : '应用'}
                </Button>
              </>
            )}
          </div>
        </footer>
      </section>
    </div>
  )
}
