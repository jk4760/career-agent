import { useCallback, useEffect, useMemo, useState } from 'react'
import { ChevronDown, FolderOpen, Pencil, Plus, Trash2 } from 'lucide-react'
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { useRepository } from '@/lib/repository'
import { cn } from '@/lib/utils'
import { CAPABILITY_L1_OPTIONS, type Material } from '@/types'

const ALL = '__all__'

/**
 * 素材库（§10.7 树状大纲/站点图式，替换卡片网格）：
 * 一级节点 = 项目（可折叠），二级行 = 故事（缩进 24px，点击就地展开）。
 * 零卡片、零阴影；行间 0.5px 细线；同一时间只展开一个故事。
 */
export default function MaterialsPage() {
  const repo = useRepository()
  const [materials, setMaterials] = useState<Material[]>([])
  const [capFilter, setCapFilter] = useState<string>(ALL)
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [formOpen, setFormOpen] = useState(false)
  const [editing, setEditing] = useState<Material | null>(null)
  const [deleting, setDeleting] = useState<Material | null>(null)

  const reload = useCallback(async () => {
    setMaterials(await repo.listMaterials())
  }, [repo])

  useEffect(() => {
    void reload()
  }, [reload])

  // 能力域筛选：未命中故事隐藏，只保留包含命中故事的项目节点（§10.7）
  const groups = useMemo(() => {
    const filtered =
      capFilter === ALL ? materials : materials.filter((m) => m.capabilityL1 === capFilter)
    const map = new Map<string, Material[]>()
    for (const m of filtered) {
      const list = map.get(m.project) ?? []
      list.push(m)
      map.set(m.project, list)
    }
    return [...map.entries()]
  }, [materials, capFilter])

  const storyCount = groups.reduce((sum, [, items]) => sum + items.length, 0)

  // 变更后无需手动 reload：repo 随 App 状态更新生成新实例，
  // 上面的 effect 会随之重新拉取（手动 reload 反而会用过期闭包覆盖新数据）
  const handleSave = async (material: Material) => {
    await repo.saveMaterial(material)
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

  return (
    <div className="space-y-4">
      {/* 顶部工具栏：筛选 + 计数 + 新建（树即分组，不再有分组开关） */}
      <div className="flex flex-wrap items-center gap-2">
        <Select value={capFilter} onValueChange={(v) => setCapFilter(v as string)}>
          <SelectTrigger className="w-44">
            <SelectValue>{(v: string) => (v === ALL ? '全部能力域' : v)}</SelectValue>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>全部能力域</SelectItem>
            {CAPABILITY_L1_OPTIONS.map((c) => (
              <SelectItem key={c} value={c}>
                {c}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <span className="text-sm text-muted-foreground tabular-nums">共 {storyCount} 个故事</span>
        <div className="flex-1" />
        <Button
          onClick={() => {
            setEditing(null)
            setFormOpen(true)
          }}
        >
          <Plus className="size-4" />
          新建故事
        </Button>
      </div>

      {groups.length === 0 ? (
        <EmptyState
          icon={FolderOpen}
          title={capFilter === ALL ? '暂无故事' : `「${capFilter}」能力域下暂无故事`}
          description="把项目经历拆成一个可讲的故事，面试时随取随用。"
          actionLabel="新建故事"
          onAction={() => {
            setEditing(null)
            setFormOpen(true)
          }}
        />
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
                              {m.tags.length > 0 && (
                                <p className="mt-2 text-xs text-foreground/50">
                                  {m.tags.map((t) => `#${t}`).join('  ')}
                                </p>
                              )}
                              <div className="mt-3 flex gap-2">
                                <Button
                                  size="sm"
                                  variant="outline"
                                  onClick={() => {
                                    setEditing(m)
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
