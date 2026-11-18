import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  ChevronRight,
  Download,
  File,
  FileText,
  FolderOpen,
  GripVertical,
  Paperclip,
  Pencil,
  Plus,
  Rows3,
  Search,
  Trash2,
  Upload,
} from 'lucide-react'
import { MaterialForm } from '@/components/MaterialForm'
import { MarkdownContent } from '@/components/MarkdownContent'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import { deriveImportDraft, formatFileSize, parseImportFile, type ImportDraft } from '@/lib/fileImport'
import { API_BASE } from '@/lib/apiRepository'
import { useRepository } from '@/lib/repository'
import { cn } from '@/lib/utils'
import type { AttachmentMeta, Material } from '@/types'

const AVATAR_TONES = [
  'bg-slate-100 text-slate-600',
  'bg-blue-50 text-blue-600',
  'bg-emerald-50 text-emerald-600',
  'bg-amber-50 text-amber-700',
  'bg-violet-50 text-violet-600',
]

function attachmentHref(materialId: string, name: string) {
  return `${API_BASE}/materials/${materialId}/attachments/${encodeURIComponent(name)}/download`
}

function createAttachmentMeta(file: File): AttachmentMeta {
  return {
    name: file.name,
    size: file.size,
    mime: file.type || 'application/octet-stream',
    importedAt: new Date().toISOString(),
  }
}

function AttachmentIcon({ meta, className }: { meta: AttachmentMeta; className?: string }) {
  const extension = meta.name.split('.').pop()?.toLowerCase()
  const Icon = extension === 'md' || extension === 'txt' ? FileText : File
  return (
    <span
      className={cn(
        'flex size-7 shrink-0 items-center justify-center rounded-md bg-slate-100 text-slate-500',
        extension === 'pdf' && 'bg-red-50 text-red-500',
        (extension === 'ppt' || extension === 'pptx') && 'bg-orange-50 text-orange-600',
        className,
      )}
    >
      <Icon className="size-3.5" />
    </span>
  )
}

function AttachmentListCell({ material }: { material: Material }) {
  if (material.attachments.length === 0) {
    return <span className="text-xs text-muted-foreground/70">暂无附件</span>
  }

  return (
    <div className="min-w-0 space-y-1">
      {material.attachments.slice(0, 3).map((attachment, index) => (
        <div key={attachment.name} className="flex min-w-0 items-center gap-1.5 text-xs">
          <Paperclip className="size-3 shrink-0 text-muted-foreground" />
          <span className="truncate text-slate-600" title={attachment.name}>
            {attachment.name}
          </span>
          {index === 2 && material.attachments.length > 3 && (
            <span className="shrink-0 rounded bg-muted px-1 text-[10px] text-muted-foreground tabular-nums">
              +{material.attachments.length - 3}
            </span>
          )}
        </div>
      ))}
    </div>
  )
}

export default function MaterialsPage() {
  const repo = useRepository()
  const [materials, setMaterials] = useState<Material[]>([])
  const [facetCounts, setFacetCounts] = useState<{ value: string; count: number }[]>([])
  const [loading, setLoading] = useState(true)
  const [facet, setFacet] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [sort, setSort] = useState<'date' | 'project'>('date')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [formOpen, setFormOpen] = useState(false)
  const [editing, setEditing] = useState<Material | null>(null)
  const [importDraft, setImportDraft] = useState<ImportDraft | null>(null)
  const [importFile, setImportFile] = useState<File | null>(null)
  const [importError, setImportError] = useState<string | null>(null)
  const [deleting, setDeleting] = useState<Material | null>(null)
  const [draggingName, setDraggingName] = useState<string | null>(null)
  const [dragOverName, setDragOverName] = useState<string | null>(null)
  const [attachmentStatus, setAttachmentStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>(
    'idle',
  )
  const fileInputRef = useRef<HTMLInputElement>(null)
  const attachmentInputRef = useRef<HTMLInputElement>(null)
  const searchInputRef = useRef<HTMLInputElement>(null)

  const reload = useCallback(async () => {
    const [nextMaterials, nextFacets] = await Promise.all([repo.listMaterials(), repo.listFacets()])
    setMaterials(nextMaterials)
    setFacetCounts(nextFacets)
    setLoading(false)
  }, [repo])

  useEffect(() => {
    void reload()
  }, [reload])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null
      if (event.key === '/' && !target?.closest('input, textarea, [contenteditable="true"]')) {
        event.preventDefault()
        searchInputRef.current?.focus()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  const visibleMaterials = useMemo(() => {
    const query = search.trim().toLowerCase()
    return materials
      .filter((material) => {
        if (facet && !material.facets.includes(facet)) return false
        if (!query) return true
        return [
          material.title,
          material.project,
          material.content ?? '',
          material.metrics ?? '',
          ...material.tags,
          ...material.facets,
        ]
          .join('\n')
          .toLowerCase()
          .includes(query)
      })
      .sort((a, b) =>
        sort === 'project'
          ? a.project.localeCompare(b.project, 'zh-CN') || a.title.localeCompare(b.title, 'zh-CN')
          : b.updatedAt.localeCompare(a.updatedAt),
      )
  }, [materials, facet, search, sort])

  const selected = materials.find((material) => material.id === selectedId) ?? null

  const openCreate = () => {
    setEditing(null)
    setImportDraft(null)
    setImportFile(null)
    setFormOpen(true)
  }

  const openEdit = (material: Material) => {
    setEditing(material)
    setImportDraft(null)
    setImportFile(null)
    setFormOpen(true)
  }

  const handleSave = async (material: Material, file?: File) => {
    const saved = await repo.saveMaterial(material)
    if (file) await repo.putAttachmentFile(saved.id, file)
    setMaterials((current) => {
      const exists = current.some((item) => item.id === saved.id)
      return exists
        ? current.map((item) => (item.id === saved.id ? saved : item))
        : [saved, ...current]
    })
    setImportDraft(null)
    setImportFile(null)
  }

  const onFileChosen = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    setImportError(null)
    try {
      const { text } = await parseImportFile(file)
      setEditing(null)
      setImportDraft(deriveImportDraft(text))
      setImportFile(file)
      setFormOpen(true)
    } catch (error) {
      setImportError(error instanceof Error ? error.message : '文件解析失败')
    }
  }

  const handleDelete = async () => {
    if (!deleting) return
    await repo.deleteMaterial(deleting.id)
    setMaterials((current) => current.filter((item) => item.id !== deleting.id))
    if (selectedId === deleting.id) setSelectedId(null)
    setDeleting(null)
  }

  const saveAttachmentOrder = async (fromIndex: number, toIndex: number) => {
    if (!selected || fromIndex === toIndex || toIndex < 0 || toIndex >= selected.attachments.length) {
      return
    }
    const attachments = [...selected.attachments]
    const [moved] = attachments.splice(fromIndex, 1)
    attachments.splice(toIndex, 0, moved)
    const optimistic = { ...selected, attachments }
    setMaterials((current) =>
      current.map((item) => (item.id === selected.id ? optimistic : item)),
    )
    setAttachmentStatus('saving')
    try {
      const saved = await repo.saveMaterial(optimistic)
      setMaterials((current) => current.map((item) => (item.id === saved.id ? saved : item)))
      setAttachmentStatus('saved')
    } catch {
      setAttachmentStatus('error')
      await reload()
    }
  }

  const onAttachmentChosen = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file || !selected) return
    if (file.size > 25 * 1024 * 1024) {
      setImportError('附件不能超过 25 MB')
      return
    }
    setAttachmentStatus('saving')
    setImportError(null)
    try {
      await repo.putAttachmentFile(selected.id, file)
      const meta = createAttachmentMeta(file)
      const attachments = [
        ...selected.attachments.filter((attachment) => attachment.name !== file.name),
        meta,
      ]
      const saved = await repo.saveMaterial({ ...selected, attachments })
      setMaterials((current) => current.map((item) => (item.id === saved.id ? saved : item)))
      setAttachmentStatus('saved')
    } catch {
      setAttachmentStatus('error')
      setImportError('附件上传失败，请稍后重试')
    }
  }

  return (
    <div className="@container">
      <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2.5">
            <h2 className="text-[22px] font-semibold tracking-[-0.02em]">素材库</h2>
            <span className="rounded-md bg-muted px-2 py-0.5 text-xs text-muted-foreground tabular-nums">
              {materials.length} 个故事
            </span>
          </div>
          <p className="mt-1 text-sm text-muted-foreground">把做过的事，沉淀成下一次机会的底气。</p>
        </div>
        <div className="flex gap-2 pt-1">
          <Button variant="outline" onClick={() => fileInputRef.current?.click()}>
            <Upload />
            导入素材
          </Button>
          <Button onClick={openCreate}>
            <Plus />
            新建故事
          </Button>
        </div>
      </div>

      <div className="mb-5 flex flex-wrap items-center gap-x-3 gap-y-2 text-sm">
        <span className="mr-1 text-xs text-muted-foreground">故事方向</span>
        <button
          type="button"
          className={cn(
            'cursor-pointer rounded-md px-2.5 py-1 outline-none focus-visible:ring-3 focus-visible:ring-ring/50',
            facet === null
              ? 'bg-accent font-medium text-accent-foreground'
              : 'text-slate-600 hover:bg-muted',
          )}
          onClick={() => setFacet(null)}
        >
          全部故事 <span className="tabular-nums">{materials.length}</span>
        </button>
        {facetCounts.map((item) => (
          <button
            key={item.value}
            type="button"
            className={cn(
              'cursor-pointer rounded-md px-2.5 py-1 outline-none focus-visible:ring-3 focus-visible:ring-ring/50',
              facet === item.value
                ? 'bg-accent font-medium text-accent-foreground'
                : 'text-slate-600 hover:bg-muted',
            )}
            onClick={() => setFacet(facet === item.value ? null : item.value)}
          >
            {item.value}{' '}
            <span className={cn('tabular-nums', facet !== item.value && 'text-muted-foreground')}>
              {item.count}
            </span>
          </button>
        ))}
      </div>

      <section className="overflow-hidden rounded-lg border bg-card">
        <div className="flex flex-wrap items-center gap-3 border-b px-4 py-3">
          <div className="relative min-w-52 flex-1">
            <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              ref={searchInputRef}
              className="max-w-md border-0 bg-muted/70 pl-9 pr-9 shadow-none focus-visible:ring-2"
              placeholder="搜索故事、项目或标签…"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
            <kbd className="pointer-events-none absolute top-1/2 right-2.5 -translate-y-1/2 rounded border bg-white px-1.5 text-[11px] text-muted-foreground">
              /
            </kbd>
          </div>
          <Select value={sort} onValueChange={(value) => setSort(value as 'date' | 'project')}>
            <SelectTrigger className="w-36 border-0 bg-muted/70 shadow-none">
              <SelectValue>
                {(value: string) => (value === 'date' ? '最近更新优先' : '按项目名称排序')}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="date">最近更新优先</SelectItem>
              <SelectItem value="project">按项目名称排序</SelectItem>
            </SelectContent>
          </Select>
          <span className="hidden rounded-md bg-muted p-1.5 text-muted-foreground sm:block" title="行式视图">
            <Rows3 className="size-4" />
          </span>
        </div>

        <div className="hidden grid-cols-[minmax(0,1.25fr)_minmax(180px,0.9fr)_minmax(120px,0.55fr)_72px_16px] items-center gap-4 px-5 py-2.5 text-xs text-muted-foreground @min-[900px]:grid">
          <span>故事 / 项目与标签</span>
          <span>相关附件</span>
          <span className="text-right">关键成果</span>
          <span className="text-right">最近更新</span>
          <span />
        </div>

        <div className="border-t">
          {loading ? (
            <p className="px-5 py-16 text-center text-sm text-muted-foreground">正在加载故事…</p>
          ) : visibleMaterials.length === 0 ? (
            <div className="flex flex-col items-center gap-2 px-5 py-16 text-center">
              {facet || search ? (
                <Search className="size-6 text-muted-foreground" strokeWidth={1.5} />
              ) : (
                <FolderOpen className="size-6 text-muted-foreground" strokeWidth={1.5} />
              )}
              <p className="text-sm font-medium">
                {facet || search ? '没有找到匹配的故事' : '还没有故事'}
              </p>
              <p className="text-sm text-muted-foreground">
                {facet || search ? '试试其他关键词或切换故事方向。' : '把项目经历拆成一个可讲的故事，面试时随取随用。'}
              </p>
              <Button
                className="mt-2"
                variant={facet || search ? 'outline' : 'default'}
                onClick={() => {
                  if (facet || search) {
                    setFacet(null)
                    setSearch('')
                  } else {
                    openCreate()
                  }
                }}
              >
                {facet || search ? '清空筛选' : '新建故事'}
              </Button>
            </div>
          ) : (
            visibleMaterials.map((material) => {
              const tone = AVATAR_TONES[
                [...material.id].reduce((sum, char) => sum + char.charCodeAt(0), 0) %
                  AVATAR_TONES.length
              ]
              const active = selectedId === material.id
              return (
                <button
                  key={material.id}
                  type="button"
                  className={cn(
                    'relative grid w-full cursor-pointer grid-cols-1 gap-4 border-b px-5 py-4 text-left outline-none transition-colors last:border-0 hover:bg-slate-50/80 focus-visible:z-10 focus-visible:ring-3 focus-visible:ring-inset focus-visible:ring-ring/50 @min-[900px]:grid-cols-[minmax(0,1.25fr)_minmax(180px,0.9fr)_minmax(120px,0.55fr)_72px_16px] @min-[900px]:items-center',
                    active && 'bg-blue-50/70',
                  )}
                  onClick={() => {
                    setSelectedId(material.id)
                    setAttachmentStatus('idle')
                    setImportError(null)
                  }}
                  aria-label={`查看故事：${material.title}`}
                >
                  {active && <span className="absolute inset-y-0 left-0 w-[3px] bg-primary" />}
                  <div className="flex min-w-0 items-center gap-3.5">
                    <span
                      className={cn(
                        'flex size-10 shrink-0 items-center justify-center rounded-lg text-[13px] font-semibold',
                        tone,
                      )}
                    >
                      {material.project.trim().slice(0, 2)}
                    </span>
                    <div className="min-w-0">
                      <div className="truncate text-sm font-semibold" title={material.title}>
                        {material.title}
                      </div>
                      <div className="mt-1 flex min-w-0 flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                        <span className="max-w-52 truncate">{material.project}</span>
                        {material.facets.length > 0 && <span className="text-border">·</span>}
                        {material.facets.slice(0, 3).map((item) => (
                          <span key={item} className="rounded bg-muted px-1.5 py-0.5 text-[11px] text-slate-500">
                            {item}
                          </span>
                        ))}
                      </div>
                    </div>
                  </div>

                  <div className="grid grid-cols-[72px_minmax(0,1fr)] items-center gap-3 @min-[900px]:block">
                    <span className="text-xs text-muted-foreground @min-[900px]:hidden">相关附件</span>
                    <AttachmentListCell material={material} />
                  </div>

                  <div className="flex items-center justify-between gap-4 @min-[900px]:block @min-[900px]:text-right">
                    <span className="text-xs text-muted-foreground @min-[900px]:hidden">关键成果</span>
                    <span className="line-clamp-2 text-sm font-semibold tabular-nums" title={material.metrics ?? undefined}>
                      {material.metrics || '—'}
                    </span>
                  </div>

                  <div className="flex items-center justify-between gap-4 @min-[900px]:block @min-[900px]:text-right">
                    <span className="text-xs text-muted-foreground @min-[900px]:hidden">最近更新</span>
                    <span className="text-xs text-slate-500 tabular-nums">
                      {material.updatedAt.slice(5, 10).replace('-', '.')}
                      <span className="block text-[10px] text-muted-foreground/70">{material.updatedAt.slice(0, 4)}</span>
                    </span>
                  </div>

                  <ChevronRight className="hidden size-4 text-slate-300 @min-[900px]:block" />
                </button>
              )
            })
          )}
        </div>
        <div className="flex items-center justify-between gap-3 px-5 py-2.5 text-xs text-muted-foreground">
          <span className="tabular-nums">
            共 {visibleMaterials.length} 个故事{facet ? ` · ${facet}` : ''}
          </span>
          <span className="hidden sm:inline">点击故事，查看完整经历</span>
        </div>
      </section>
      {importError && <p className="mt-3 text-xs text-destructive">{importError}</p>}

      <input
        ref={fileInputRef}
        type="file"
        accept=".md,.docx,.pdf"
        className="hidden"
        onChange={onFileChosen}
      />

      <Sheet
        open={selectedId !== null}
        onOpenChange={(open) => {
          if (!open) setSelectedId(null)
        }}
      >
        <SheetContent className="max-w-[560px] gap-0">
          {selected && (
            <>
              <SheetHeader className="px-6 py-4">
                <SheetDescription className="text-xs">素材库</SheetDescription>
                <SheetTitle>故事详情</SheetTitle>
              </SheetHeader>
              <div className="flex-1 overflow-y-auto px-6 py-5">
                <div className="flex flex-wrap gap-1.5">
                  {selected.facets.map((item) => (
                    <span key={item} className="rounded bg-muted px-2 py-0.5 text-xs text-slate-500">
                      {item}
                    </span>
                  ))}
                </div>
                {(selected.role || selected.duration) && (
                  <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-xs text-muted-foreground">
                    {selected.role && (
                      <span>
                        我的角色 <span className="ml-2 text-slate-600">{selected.role}</span>
                      </span>
                    )}
                    {selected.duration && <span>{selected.duration}</span>}
                  </div>
                )}
                <h3 className="mt-4 text-xl font-semibold leading-snug tracking-[-0.01em]">
                  {selected.title}
                </h3>
                <p className="mt-1 text-sm text-muted-foreground">{selected.project}</p>

                {selected.metrics && (
                  <div className="mt-5 rounded-lg bg-blue-50/80 px-4 py-3.5">
                    <div className="flex items-center gap-1.5 text-xs font-medium text-blue-700">
                      <span className="size-1.5 rounded-full bg-blue-500" />
                      关键成果
                    </div>
                    <p className="mt-1 text-[17px] font-semibold leading-relaxed text-blue-950">
                      {selected.metrics}
                    </p>
                  </div>
                )}

                <div className="mt-6">
                  <h4 className="mb-2 text-sm font-semibold">完整经历</h4>
                  {selected.content ? (
                    <MarkdownContent content={selected.content} />
                  ) : (
                    <p className="text-sm text-muted-foreground">暂无经历内容，点击底部「编辑故事」补充。</p>
                  )}
                </div>
                {selected.tags.length > 0 && (
                  <p className="mt-5 text-xs leading-relaxed text-muted-foreground">
                    {selected.tags.map((tag) => `#${tag}`).join('  ')}
                  </p>
                )}

                <div className="mt-7 border-t pt-5">
                  <div className="flex items-center justify-between">
                    <h4 className="text-sm font-semibold">
                      相关附件{' '}
                      <span className="ml-1 rounded bg-muted px-1.5 py-0.5 text-xs font-normal text-muted-foreground tabular-nums">
                        {selected.attachments.length}
                      </span>
                    </h4>
                    <Button variant="ghost" size="sm" onClick={() => attachmentInputRef.current?.click()}>
                      <Plus />
                      添加附件
                    </Button>
                  </div>
                  <p className="mt-1 flex items-center gap-1.5 text-xs text-muted-foreground">
                    <GripVertical className="size-3.5" />
                    拖动左侧手柄调整顺序，前三项展示在列表中。
                  </p>

                  <div className="mt-3 overflow-hidden rounded-lg border">
                    {selected.attachments.length === 0 ? (
                      <button
                        type="button"
                        className="flex w-full cursor-pointer flex-col items-center gap-1.5 px-4 py-8 text-sm text-muted-foreground hover:bg-muted/50"
                        onClick={() => attachmentInputRef.current?.click()}
                      >
                        <Paperclip className="size-5" />
                        添加第一份附件
                      </button>
                    ) : (
                      selected.attachments.map((attachment, index) => (
                        <div
                          key={attachment.name}
                          className={cn(
                            'flex items-center gap-2 border-b px-3 py-3 transition-colors last:border-0',
                            dragOverName === attachment.name && draggingName !== attachment.name && 'bg-blue-50',
                            draggingName === attachment.name && 'opacity-50',
                          )}
                          onDragOver={(event) => {
                            event.preventDefault()
                            setDragOverName(attachment.name)
                          }}
                          onDragLeave={() => setDragOverName(null)}
                          onDrop={(event) => {
                            event.preventDefault()
                            const fromIndex = selected.attachments.findIndex(
                              (item) => item.name === draggingName,
                            )
                            void saveAttachmentOrder(fromIndex, index)
                            setDraggingName(null)
                            setDragOverName(null)
                          }}
                        >
                          <button
                            type="button"
                            draggable={attachmentStatus !== 'saving'}
                            className="cursor-grab rounded p-1 text-slate-400 outline-none hover:bg-muted hover:text-slate-600 focus-visible:ring-2 focus-visible:ring-ring/50 active:cursor-grabbing"
                            aria-label={`调整 ${attachment.name} 的顺序，当前第 ${index + 1} 项；也可使用上下方向键`}
                            title="拖拽排序；聚焦后可用上下方向键"
                            onDragStart={(event) => {
                              setDraggingName(attachment.name)
                              event.dataTransfer.effectAllowed = 'move'
                              event.dataTransfer.setData('text/plain', attachment.name)
                            }}
                            onDragEnd={() => {
                              setDraggingName(null)
                              setDragOverName(null)
                            }}
                            onKeyDown={(event) => {
                              if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
                                event.preventDefault()
                                void saveAttachmentOrder(
                                  index,
                                  event.key === 'ArrowUp' ? index - 1 : index + 1,
                                )
                              }
                            }}
                          >
                            <GripVertical className="size-4" />
                          </button>
                          <AttachmentIcon meta={attachment} />
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-sm font-medium" title={attachment.name}>
                              {attachment.name}
                            </p>
                            <p className="mt-0.5 text-[11px] text-muted-foreground tabular-nums">
                              {formatFileSize(attachment.size)}
                            </p>
                          </div>
                          <span className="hidden text-[11px] text-muted-foreground tabular-nums sm:inline">
                            {String(index + 1).padStart(2, '0')}
                          </span>
                          {index < 3 && (
                            <span className="hidden rounded bg-accent px-1.5 py-0.5 text-[11px] text-accent-foreground sm:inline">
                              列表展示
                            </span>
                          )}
                          <Button
                            variant="ghost"
                            size="icon-sm"
                            aria-label={`下载 ${attachment.name}`}
                            render={<a href={attachmentHref(selected.id, attachment.name)} />}
                          >
                            <Download />
                          </Button>
                        </div>
                      ))
                    )}
                  </div>
                  <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground">
                    支持 MD、PPT、PDF 等文件，单文件最大 25 MB。
                    {attachmentStatus === 'saving' && ' 正在保存顺序…'}
                    {attachmentStatus === 'saved' && ' 顺序已自动保存。'}
                    {attachmentStatus === 'error' && ' 保存失败，已恢复原顺序，请重试。'}
                  </p>
                </div>
              </div>
              <SheetFooter className="items-center justify-between bg-card px-6 py-3">
                <span className="text-xs text-muted-foreground tabular-nums">
                  更新于 {selected.updatedAt.slice(0, 10).replaceAll('-', '.')}
                </span>
                <div className="flex gap-2">
                  <Button variant="ghost" onClick={() => setDeleting(selected)}>
                    <Trash2 className="text-destructive" />
                    删除
                  </Button>
                  <Button onClick={() => openEdit(selected)}>
                    <Pencil />
                    编辑故事
                  </Button>
                </div>
              </SheetFooter>
            </>
          )}
        </SheetContent>
      </Sheet>

      <input
        ref={attachmentInputRef}
        type="file"
        className="hidden"
        onChange={onAttachmentChosen}
      />

      <MaterialForm
        open={formOpen}
        initial={editing}
        importDraft={importDraft}
        importFile={importFile}
        onOpenChange={setFormOpen}
        onSave={handleSave}
      />

      <AlertDialog
        open={deleting !== null}
        onOpenChange={(open) => {
          if (!open) setDeleting(null)
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>确认删除这个故事？</AlertDialogTitle>
            <AlertDialogDescription>
              「{deleting?.title}」删除后不可恢复，问题库中关联它的问题将变为未关联。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete}>删除</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
