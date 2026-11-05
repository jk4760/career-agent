import { useCallback, useEffect, useMemo, useState } from 'react'
import { Check, Pencil, Plus, Trash2 } from 'lucide-react'
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
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { useRepository } from '@/lib/repository'
import { CAPABILITY_L1_OPTIONS, type Material } from '@/types'

const ALL = '__all__'

export default function MaterialsPage() {
  const repo = useRepository()
  const [materials, setMaterials] = useState<Material[]>([])
  const [grouped, setGrouped] = useState(true)
  const [capFilter, setCapFilter] = useState<string>(ALL)
  const [formOpen, setFormOpen] = useState(false)
  const [editing, setEditing] = useState<Material | null>(null)
  const [deleting, setDeleting] = useState<Material | null>(null)

  const reload = useCallback(async () => {
    setMaterials(await repo.listMaterials())
  }, [repo])

  useEffect(() => {
    void reload()
  }, [reload])

  const filtered = useMemo(
    () => (capFilter === ALL ? materials : materials.filter((m) => m.capabilityL1 === capFilter)),
    [materials, capFilter],
  )

  const groups = useMemo(() => {
    const map = new Map<string, Material[]>()
    for (const m of filtered) {
      const list = map.get(m.project) ?? []
      list.push(m)
      map.set(m.project, list)
    }
    return [...map.entries()]
  }, [filtered])

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

  const renderCard = (m: Material) => (
    <Card key={m.id}>
      <CardContent className="space-y-2 p-4">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="font-medium">{m.title}</div>
            <div className="mt-0.5 text-sm text-muted-foreground">
              {m.project}
              {m.role ? ` · ${m.role}` : ''}
              {m.duration ? ` · ${m.duration}` : ''}
            </div>
          </div>
          <div className="flex shrink-0 gap-1">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setEditing(m)
                setFormOpen(true)
              }}
            >
              <Pencil className="size-3.5" />
              编辑
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setDeleting(m)}>
              <Trash2 className="size-3.5 text-destructive" />
              删除
            </Button>
          </div>
        </div>

        <div className="flex flex-wrap gap-1.5">
          {m.capabilityL1 && <Badge variant="secondary">{m.capabilityL1}</Badge>}
          {m.capabilityL2 && <Badge variant="secondary">{m.capabilityL2}</Badge>}
          {m.tags.map((t) => (
            <Badge key={t} variant="outline">
              {t}
            </Badge>
          ))}
        </div>

        {m.metrics && <p className="text-sm text-emerald-700">{m.metrics}</p>}
        {m.content && (
          <p className="line-clamp-2 text-sm whitespace-pre-wrap text-muted-foreground">
            {m.content}
          </p>
        )}
      </CardContent>
    </Card>
  )

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-xl font-semibold">素材库</h1>
          <p className="mt-0.5 text-sm text-muted-foreground">
            一行一个故事，共 {materials.length} 个故事
          </p>
        </div>
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
        <Button variant="outline" onClick={() => setGrouped((v) => !v)} aria-pressed={grouped}>
          {grouped && <Check className="size-4" />}
          按项目分组
        </Button>
      </div>

      {filtered.length === 0 ? (
        <p className="py-16 text-center text-sm text-muted-foreground">暂无故事，点击右上角新建</p>
      ) : grouped ? (
        <div className="space-y-6">
          {groups.map(([project, items]) => (
            <section key={project} className="space-y-3">
              <h2 className="text-sm font-medium text-muted-foreground">
                {project}（{items.length}）
              </h2>
              <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">{items.map(renderCard)}</div>
            </section>
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">{filtered.map(renderCard)}</div>
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
