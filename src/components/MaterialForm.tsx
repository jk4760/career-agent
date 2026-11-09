import { useEffect, useState } from 'react'
import { X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { CAPABILITY_L1_OPTIONS, type Material } from '@/types'

const NONE = '__none__'

function parseTags(input: string): string[] {
  return input
    .split(/[,，]/)
    .map((t) => t.trim())
    .filter(Boolean)
}

interface MaterialFormProps {
  open: boolean
  /** null 表示新建 */
  initial: Material | null
  /** 「+ 新增」chip 路径：新建时预填的经历标签（§10.7） */
  prefillFacet?: string | null
  onOpenChange: (open: boolean) => void
  onSave: (material: Material) => void
}

/** 素材（故事）新建/编辑对话框，字段对应 materials 表全字段 */
export function MaterialForm({ open, initial, prefillFacet, onOpenChange, onSave }: MaterialFormProps) {
  const [project, setProject] = useState('')
  const [title, setTitle] = useState('')
  const [role, setRole] = useState('')
  const [duration, setDuration] = useState('')
  const [capabilityL1, setCapabilityL1] = useState('')
  const [capabilityL2, setCapabilityL2] = useState('')
  const [tags, setTags] = useState('')
  const [facets, setFacets] = useState<string[]>([])
  const [facetInput, setFacetInput] = useState('')
  const [metrics, setMetrics] = useState('')
  const [content, setContent] = useState('')

  useEffect(() => {
    if (!open) return
    setProject(initial?.project ?? '')
    setTitle(initial?.title ?? '')
    setRole(initial?.role ?? '')
    setDuration(initial?.duration ?? '')
    setCapabilityL1(initial?.capabilityL1 ?? '')
    setCapabilityL2(initial?.capabilityL2 ?? '')
    setTags(initial?.tags.join(', ') ?? '')
    setFacets(initial?.facets ?? (prefillFacet ? [prefillFacet] : []))
    setFacetInput('')
    setMetrics(initial?.metrics ?? '')
    setContent(initial?.content ?? '')
  }, [open, initial, prefillFacet])

  const canSave = project.trim() !== '' && title.trim() !== ''

  const handleSave = () => {
    if (!canSave) return
    onSave({
      id: initial?.id ?? crypto.randomUUID(),
      project: project.trim(),
      title: title.trim(),
      role: role.trim() || null,
      duration: duration.trim() || null,
      capabilityL1: capabilityL1 || null,
      capabilityL2: capabilityL2.trim() || null,
      tags: parseTags(tags),
      facets,
      metrics: metrics.trim() || null,
      content: content.trim() || null,
      others: initial?.others ?? null,
      updatedAt: initial?.updatedAt ?? new Date().toISOString(),
    })
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{initial ? '编辑故事' : '新建故事'}</DialogTitle>
        </DialogHeader>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {/* 第一行：经历标签（facets），回车添加、可逐个删除（§10.7） */}
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="m-facets">经历标签</Label>
            <div className="flex min-h-8 w-full flex-wrap items-center gap-1.5 rounded-md border border-input bg-white px-2 py-1.5 focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/50">
              {facets.map((f) => (
                <span
                  key={f}
                  className="flex items-center gap-1 rounded bg-accent px-1.5 py-0.5 text-xs text-accent-foreground"
                >
                  {f}
                  <button
                    type="button"
                    aria-label={`删除标签 ${f}`}
                    className="cursor-pointer"
                    onClick={() => setFacets(facets.filter((x) => x !== f))}
                  >
                    <X className="size-3" />
                  </button>
                </span>
              ))}
              <input
                id="m-facets"
                className="min-w-24 flex-1 bg-transparent text-sm outline-none"
                placeholder={facets.length === 0 ? '回车添加，如：互联网、字节跳动' : ''}
                value={facetInput}
                onChange={(e) => setFacetInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.nativeEvent.isComposing) return
                  if (
                    (e.key === 'Enter' || e.key === ',' || e.key === '，') &&
                    facetInput.trim()
                  ) {
                    e.preventDefault()
                    const v = facetInput.trim()
                    if (!facets.includes(v)) setFacets([...facets, v])
                    setFacetInput('')
                  } else if (e.key === 'Backspace' && !facetInput && facets.length > 0) {
                    setFacets(facets.slice(0, -1))
                  }
                }}
              />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="m-project">所属项目 *</Label>
            <Input
              id="m-project"
              placeholder="如：电商数据中台"
              value={project}
              onChange={(e) => setProject(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="m-title">故事标题 *</Label>
            <Input
              id="m-title"
              placeholder="一句话说清场景"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="m-role">担任角色</Label>
            <Input
              id="m-role"
              placeholder="如：数据分析师"
              value={role}
              onChange={(e) => setRole(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="m-duration">时间段</Label>
            <Input
              id="m-duration"
              placeholder="如：2023.03–2024.06"
              value={duration}
              onChange={(e) => setDuration(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label>能力域（capability_l1）</Label>
            <Select
              value={capabilityL1 || NONE}
              onValueChange={(v) => setCapabilityL1(v === NONE ? '' : (v as string))}
            >
              <SelectTrigger className="w-full">
                <SelectValue>{(v: string) => (v === NONE ? '未设置' : v)}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE}>未设置</SelectItem>
                {CAPABILITY_L1_OPTIONS.map((c) => (
                  <SelectItem key={c} value={c}>
                    {c}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="m-cap2">细分能力（capability_l2）</Label>
            <Input
              id="m-cap2"
              placeholder="如：指标体系搭建"
              value={capabilityL2}
              onChange={(e) => setCapabilityL2(e.target.value)}
            />
          </div>
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="m-tags">自由标签（逗号分隔）</Label>
            <Input
              id="m-tags"
              placeholder="如：SQL, 看板, 北极星指标"
              value={tags}
              onChange={(e) => setTags(e.target.value)}
            />
          </div>
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="m-metrics">量化成果</Label>
            <Input
              id="m-metrics"
              placeholder="一两个即可，如：报表人力成本下降 60%"
              value={metrics}
              onChange={(e) => setMetrics(e.target.value)}
            />
          </div>
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="m-content">故事内容（markdown，自由结构）</Label>
            <Textarea
              id="m-content"
              rows={8}
              placeholder="不强制 STAR 四段，按自己的结构写"
              value={content}
              onChange={(e) => setContent(e.target.value)}
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            取消
          </Button>
          <Button onClick={handleSave} disabled={!canSave}>
            保存
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
