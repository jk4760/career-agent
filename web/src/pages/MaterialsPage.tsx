import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ChevronDown, Download, FolderOpen, Paperclip, Pencil, Plus, Search, Trash2, Upload } from 'lucide-react'
import { EmptyState } from '@/components/EmptyState'
import { MarkdownContent } from '@/components/MarkdownContent'
import { MaterialForm } from '@/components/MaterialForm'
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
import { deriveImportDraft, formatFileSize, parseImportFile, type ImportDraft } from '@/lib/fileImport'
import { useRepository } from '@/lib/repository'
import { cn } from '@/lib/utils'
import type { AttachmentMeta, Material } from '@/types'

/** 附件行：文件名 + 大小 + 下载（浏览器端保存原文件；本体丢失时提示重新导入） */
function AttachmentRow({ materialId, meta }: { materialId: string; meta: AttachmentMeta }) {
  const repo = useRepository()
  const [missing, setMissing] = useState(false)

  const download = async () => {
    const file = await repo.getAttachmentFile(materialId, meta.name)
    if (!file) {
      setMissing(true)
      return
    }
    const url = URL.createObjectURL(file)
    const a = document.createElement('a')
    a.href = url
    a.download = meta.name
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="flex flex-wrap items-center gap-2 text-xs">
      <Paperclip className="size-3.5 text-muted-foreground" />
      <span>{meta.name}</span>
      <span className="text-muted-foreground tabular-nums">{formatFileSize(meta.size)}</span>
      <Button variant="ghost" size="xs" onClick={download}>
        <Download className="size-3.5" />
        下载
      </Button>
      {missing && <span className="text-status-new">刷新后文件本体已丢失，请重新导入</span>}
    </div>
  )
}

/**
 * 素材库（§10.7 树状大纲/站点图式）：
 * 第一行 facet chips（数据派生，替代能力域下拉）+ 第二行搜索框 + 两级树。
 * 零卡片、零阴影；行间 0.5px 细线；同一时间只展开一个故事。
 */
export default function MaterialsPage() {
  const repo = useRepository()
  const [materials, setMaterials] = useState<Material[]>([])
  const [facetCounts, setFacetCounts] = useState<{ value: string; count: number }[]>([])
  const [facet, setFacet] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [formOpen, setFormOpen] = useState(false)
  const [editing, setEditing] = useState<Material | null>(null)
  const [prefillFacet, setPrefillFacet] = useState<string | null>(null)
  const [importDraft, setImportDraft] = useState<ImportDraft | null>(null)
  const [importFile, setImportFile] = useState<File | null>(null)
  const [importError, setImportError] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [addingFacet, setAddingFacet] = useState(false)
  const [facetDraft, setFacetDraft] = useState('')
  const [deleting, setDeleting] = useState<Material | null>(null)

  const reload = useCallback(async () => {
    const [ms, fs] = await Promise.all([repo.listMaterials(), repo.listFacets()])
    setMaterials(ms)
    setFacetCounts(fs)
  }, [repo])

  useEffect(() => {
    void reload()
  }, [reload])

  // facet 筛选与搜索为 AND 关系；只保留包含命中故事的项目节点（§10.7）
  const groups = useMemo(() => {
    const q = search.trim().toLowerCase()
    const filtered = materials.filter((m) => {
      if (facet && !m.facets.includes(facet)) return false
      if (!q) return true
      const haystack = [m.title, m.content ?? '', ...m.tags, ...m.facets]
        .join('\n')
        .toLowerCase()
      return haystack.includes(q)
    })
    const map = new Map<string, Material[]>()
    for (const m of filtered) {
      const list = map.get(m.project) ?? []
      list.push(m)
      map.set(m.project, list)
    }
    return [...map.entries()]
  }, [materials, facet, search])

  const storyCount = groups.reduce((sum, [, items]) => sum + items.length, 0)
  const filtering = facet !== null || search.trim() !== ''

  // 变更后无需手动 reload：repo 随 App 状态更新生成新实例，
  // 上面的 effect 会随之重新拉取（手动 reload 反而会用过期闭包覆盖新数据）
  const handleSave = async (material: Material, file?: File) => {
    const saved = await repo.saveMaterial(material)
    // 导入路径：原文件本体挂为故事附件（元信息已在 attachments 中）
    if (file) await repo.putAttachmentFile(saved.id, file)
    setImportDraft(null)
    setImportFile(null)
  }

  // 「导入文件」（§10.9）：本地解析 .md/.docx/.pdf，启发式预填抽屉表单
  const onFileChosen = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    setImportError(null)
    try {
      const { text } = await parseImportFile(file)
      setEditing(null)
      setPrefillFacet(null)
      setImportDraft(deriveImportDraft(text))
      setImportFile(file)
      setFormOpen(true)
    } catch (err) {
      setImportError(err instanceof Error ? err.message : '文件解析失败')
    }
  }

  const handleDelete = async () => {
    if (!deleting) return
    await repo.deleteMaterial(deleting.id)
    setDeleting(null)
  }

  const toggleProject = (project: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev)
      if (next.has(project)) {
        next.delete(project)
      } else {
        next.add(project)
      }
      return next
    })
  }

  const chipClass = (active: boolean) =>
    cn(
      'shrink-0 cursor-pointer rounded-lg border px-2 py-1 text-xs whitespace-nowrap transition-colors outline-none focus-visible:ring-3 focus-visible:ring-ring/50',
      active
        ? 'border-transparent bg-accent font-medium text-accent-foreground'
        : 'bg-white text-muted-foreground hover:bg-muted',
    )

  // 「+ 新增」不直接创建标签：输入后打开新建表单并预填该标签（§10.7）
  const commitFacetDraft = () => {
    const v = facetDraft.trim()
    setAddingFacet(false)
    setFacetDraft('')
    if (!v) return
    setEditing(null)
    setPrefillFacet(v)
    setImportDraft(null)
    setImportFile(null)
    setFormOpen(true)
  }

  return (
    <div className="space-y-4">
      {/* 第一行：facet chips 筛选行（超宽横向滚动） */}
      <div className="flex items-center gap-1.5">
        <div className="flex min-w-0 flex-1 items-center gap-1.5 overflow-x-auto">
          <button type="button" className={chipClass(facet === null)} onClick={() => setFacet(null)}>
            全部
          </button>
          {facetCounts.map((f) => (
            <button
              key={f.value}
              type="button"
              className={chipClass(facet === f.value)}
              onClick={() => setFacet(facet === f.value ? null : f.value)}
            >
              {f.value}{' '}
              <span className="text-xs text-muted-foreground tabular-nums">{f.count}</span>
            </button>
          ))}
          {addingFacet ? (
            <input
              autoFocus
              className="w-24 shrink-0 rounded-lg border border-dashed bg-white px-2 py-1 text-xs outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
              placeholder="新标签名"
              value={facetDraft}
              onChange={(e) => setFacetDraft(e.target.value)}
              onBlur={commitFacetDraft}
              onKeyDown={(e) => {
                if (e.nativeEvent.isComposing) return
                if (e.key === 'Enter') commitFacetDraft()
                if (e.key === 'Escape') {
                  setAddingFacet(false)
                  setFacetDraft('')
                }
              }}
            />
          ) : (
            <button
              type="button"
              className="shrink-0 cursor-pointer rounded-lg border border-dashed px-2 py-1 text-xs whitespace-nowrap text-muted-foreground transition-colors outline-none hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50"
              onClick={() => setAddingFacet(true)}
            >
              + 新增
            </button>
          )}
        </div>
        <span className="shrink-0 text-sm text-muted-foreground tabular-nums">
          共 {storyCount} 个故事
        </span>
        {/* 导入文件（次按钮）与新建故事（主按钮）并列（§10.9） */}
        <Button variant="outline" className="shrink-0" onClick={() => fileInputRef.current?.click()}>
          <Upload className="size-4" />
          导入文件
        </Button>
        <Button
          className="shrink-0"
          onClick={() => {
            setEditing(null)
            setPrefillFacet(null)
            setImportDraft(null)
            setImportFile(null)
            setFormOpen(true)
          }}
        >
          <Plus className="size-4" />
          新建故事
        </Button>
        <input
          ref={fileInputRef}
          type="file"
          accept=".md,.docx,.pdf"
          className="hidden"
          onChange={onFileChosen}
        />
      </div>

      {/* 第二行：搜索框（title / tags / facets / content 子串匹配，不区分大小写） */}
      <div className="flex items-center gap-2">
        <div className="relative w-full max-w-sm">
          <Search className="absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            className="pl-8"
            placeholder="搜索故事标题 / 标签 / 内容"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        {importError && <span className="text-xs text-destructive">{importError}</span>}
      </div>

      {groups.length === 0 ? (
        filtering ? (
          <EmptyState
            icon={Search}
            title="没有符合条件的故事"
            description="换个关键词或 facet 试试。"
            actionLabel="清空筛选"
            onAction={() => {
              setFacet(null)
              setSearch('')
            }}
          />
        ) : (
          <EmptyState
            icon={FolderOpen}
            title="暂无故事"
            description="把项目经历拆成一个可讲的故事，面试时随取随用。"
            actionLabel="新建故事"
            onAction={() => {
              setEditing(null)
              setPrefillFacet(null)
              setImportDraft(null)
              setImportFile(null)
              setFormOpen(true)
            }}
          />
        )
      ) : (
        <div className="rounded-lg border bg-card [&>*+*]:border-t-[0.5px] [&>*+*]:border-border">
          {groups.map(([project, items]) => {
            const isCollapsed = collapsed.has(project)
            return (
              <div key={project}>
                {/* 一级节点：项目（点击折叠/展开，hover 底色 slate-50） */}
                <button
                  type="button"
                  className="flex w-full cursor-pointer items-center gap-2 px-3 py-2 text-left outline-none hover:bg-slate-50 focus-visible:ring-3 focus-visible:ring-ring/50"
                  onClick={() => toggleProject(project)}
                  aria-expanded={!isCollapsed}
                >
                  <ChevronDown
                    className={cn(
                      'size-4 shrink-0 text-muted-foreground transition-transform',
                      isCollapsed && '-rotate-90',
                    )}
                  />
                  <span className="text-[13px] font-semibold">{project}</span>
                  <span className="rounded bg-muted px-1.5 py-px text-[11px] text-slate-400 tabular-nums">
                    {items.length}
                  </span>
                </button>

                {/* 二级行：故事（缩进 24px） */}
                {!isCollapsed &&
                  items.map((m) => {
                    const expanded = expandedId === m.id
                    return (
                      <div key={m.id} className="border-t-[0.5px] border-border">
                        <button
                          type="button"
                          className="flex w-full cursor-pointer items-baseline gap-2 py-2 pr-3 pl-6 text-left outline-none hover:bg-slate-50 focus-visible:ring-3 focus-visible:ring-ring/50 sm:pl-9"
                          onClick={() => setExpandedId(expanded ? null : m.id)}
                          aria-expanded={expanded}
                        >
                          <span className="shrink-0 text-sm font-medium">{m.title}</span>
                          {m.capabilityL1 && (
                            <span className="shrink-0 rounded bg-accent px-1.5 py-px text-[11px] text-accent-foreground">
                              {m.capabilityL1}
                            </span>
                          )}
                          {m.capabilityL2 && (
                            <span className="shrink-0 rounded bg-accent px-1.5 py-px text-[11px] text-accent-foreground">
                              {m.capabilityL2}
                            </span>
                          )}
                          {m.metrics && (
                            <span className="min-w-0 flex-1 truncate text-right text-xs text-muted-foreground tabular-nums">
                              {m.metrics}
                            </span>
                          )}
                          {!m.metrics && <span className="flex-1" />}
                          <span className="shrink-0 text-[11px] text-foreground/50 tabular-nums">
                            {m.updatedAt.slice(0, 10)}
                          </span>
                        </button>

                        {expanded && (
                          <div className="border-t-[0.5px] border-border bg-muted/40 py-3 pr-4 pl-6 sm:pl-9">
                            <div className="row-expand max-w-3xl">
                              {m.role || m.duration ? (
                                <p className="mb-2 text-xs text-muted-foreground">
                                  {m.role}
                                  {m.role && m.duration ? ' · ' : ''}
                                  {m.duration}
                                </p>
                              ) : null}
                              {m.content ? (
                                <MarkdownContent content={m.content} />
                              ) : (
                                <p className="text-sm text-muted-foreground">（暂无内容）</p>
                              )}
                              {m.facets.length > 0 && (
                                <p className="mt-2 flex flex-wrap gap-1.5">
                                  {m.facets.map((f) => (
                                    <span
                                      key={f}
                                      className="rounded bg-accent px-1.5 py-px text-[11px] text-accent-foreground"
                                    >
                                      {f}
                                    </span>
                                  ))}
                                </p>
                              )}
                              {m.tags.length > 0 && (
                                <p className="mt-2 text-xs text-foreground/50">
                                  {m.tags.map((t) => `#${t}`).join('  ')}
                                </p>
                              )}
                              {/* 附件行（§10.9）：文件名 + 大小 + 下载 */}
                              {m.attachments.length > 0 && (
                                <div className="mt-3 space-y-1.5 border-t-[0.5px] border-border pt-2.5">
                                  {m.attachments.map((a) => (
                                    <AttachmentRow key={a.name} materialId={m.id} meta={a} />
                                  ))}
                                </div>
                              )}
                              <div className="mt-3 flex gap-2">
                                <Button
                                  size="sm"
                                  variant="outline"
                                  onClick={() => {
                                    setEditing(m)
                                    setPrefillFacet(null)
                                    setImportDraft(null)
                                    setImportFile(null)
                                    setFormOpen(true)
                                  }}
                                >
                                  <Pencil className="size-3.5" />
                                  编辑
                                </Button>
                                <Button size="sm" variant="outline" onClick={() => setDeleting(m)}>
                                  <Trash2 className="size-3.5 text-destructive" />
                                  删除
                                </Button>
                              </div>
                            </div>
                          </div>
                        )}
                      </div>
                    )
                  })}
              </div>
            )
          })}
        </div>
      )}

      <MaterialForm
        open={formOpen}
        initial={editing}
        prefillFacet={prefillFacet}
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
