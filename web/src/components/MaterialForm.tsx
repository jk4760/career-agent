import { useEffect, useRef, useState } from 'react'
import { CircleAlert, CircleCheck, LoaderCircle, Paperclip, Plus, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import { Textarea } from '@/components/ui/textarea'
import { formatFileSize, type ImportDraft } from '@/lib/fileImport'
import { uuid } from '@/lib/utils'
import { CAPABILITY_L1_OPTIONS, type Material } from '@/types'

const MAX_ATTACHMENT_SIZE = 25 * 1024 * 1024

function parseTags(input: string): string[] {
  return input
    .split(/[,，]/)
    .map((tag) => tag.trim())
    .filter(Boolean)
}

type AttachmentUpload = {
  file: File
  status: 'pending' | 'uploading' | 'success' | 'error'
  message?: string
}

export interface MaterialSaveResult {
  material: Material
  failedFiles: File[]
}

interface MaterialFormProps {
  open: boolean
  initial: Material | null
  prefillFacet?: string | null
  importDraft?: ImportDraft | null
  importFile?: File | null
  onOpenChange: (open: boolean) => void
  onSave: (material: Material, files: File[]) => Promise<MaterialSaveResult>
}

export function MaterialForm({
  open,
  initial,
  prefillFacet,
  importDraft,
  importFile,
  onOpenChange,
  onSave,
}: MaterialFormProps) {
  const [materialId, setMaterialId] = useState('')
  const [savedMaterial, setSavedMaterial] = useState<Material | null>(null)
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
  const [attachmentFiles, setAttachmentFiles] = useState<AttachmentUpload[]>([])
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!open) return
    setMaterialId(initial?.id ?? uuid())
    setSavedMaterial(null)
    setProject(initial?.project ?? '')
    setTitle(initial?.title ?? importDraft?.title ?? '')
    setRole(initial?.role ?? '')
    setDuration(initial?.duration ?? '')
    setCapabilityL1(initial?.capabilityL1 ?? '')
    setCapabilityL2(initial?.capabilityL2 ?? '')
    setTags(initial?.tags.join(', ') ?? '')
    setFacets(initial?.facets ?? (prefillFacet ? [prefillFacet] : []))
    setFacetInput('')
    setMetrics(initial?.metrics ?? importDraft?.metrics ?? '')
    setContent(initial?.content ?? importDraft?.content ?? '')
    setAttachmentFiles(importFile ? [{ file: importFile, status: 'pending' }] : [])
    setSaving(false)
    setSaveError(null)
  }, [open, initial, prefillFacet, importDraft, importFile])

  const materialBase = savedMaterial ?? initial
  const existingAttachments = materialBase?.attachments ?? []
  const canSave = project.trim() !== '' && title.trim() !== '' && !saving
  const hasUnsavedAttachments = attachmentFiles.some((item) => item.status === 'pending' || item.status === 'error')

  const requestClose = (nextOpen: boolean) => {
    if (nextOpen) {
      onOpenChange(true)
      return
    }
    if (saving) {
      setSaveError('正在保存故事和附件，请等待本次操作完成。')
      return
    }
    if (hasUnsavedAttachments && !window.confirm('仍有未保存的附件选择，关闭后这些选择会丢失。确定关闭吗？')) return
    onOpenChange(false)
  }

  const onFilesChosen = (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? [])
    event.target.value = ''
    if (!files.length) return
    const accepted: AttachmentUpload[] = []
    const rejected: string[] = []
    for (const file of files) {
      if (file.size > MAX_ATTACHMENT_SIZE) rejected.push(file.name)
      else accepted.push({ file, status: 'pending' })
    }
    setAttachmentFiles((current) => [
      ...current.filter((item) => !accepted.some(({ file }) => file.name === item.file.name)),
      ...accepted,
    ])
    setSaveError(rejected.length ? `${rejected.join('、')} 超过 25 MB，未添加。` : null)
  }

  const handleSave = async () => {
    if (!canSave) return
    const files = attachmentFiles
      .filter((item) => item.status === 'pending' || item.status === 'error')
      .map((item) => item.file)
    const uploading = new Set(files)
    setSaving(true)
    setSaveError(null)
    setAttachmentFiles((current) => current.map((item) => (
      uploading.has(item.file) ? { file: item.file, status: 'uploading' } : item
    )))
    try {
      const result = await onSave(
        {
          id: materialId,
          project: project.trim(),
          title: title.trim(),
          role: role.trim() || null,
          duration: duration.trim() || null,
          capabilityL1: capabilityL1.trim() || null,
          capabilityL2: capabilityL2.trim() || null,
          tags: parseTags(tags),
          facets,
          metrics: metrics.trim() || null,
          content: content.trim() || null,
          attachments: existingAttachments,
          others: materialBase?.others ?? null,
          updatedAt: materialBase?.updatedAt ?? new Date().toISOString(),
        },
        files,
      )
      setSavedMaterial(result.material)
      const failed = new Set(result.failedFiles)
      setAttachmentFiles((current) => current.map((item) => {
        if (!uploading.has(item.file)) return item
        return failed.has(item.file)
          ? { file: item.file, status: 'error', message: '上传失败，可重试' }
          : { file: item.file, status: 'success' }
      }))
      if (result.failedFiles.length) {
        setSaveError('故事已保存，部分附件上传失败。可点击“重试附件上传”，不会重复创建故事或已成功附件。')
        return
      }
      onOpenChange(false)
    } catch (error) {
      setAttachmentFiles((current) => current.map((item) => (
        uploading.has(item.file) ? { file: item.file, status: 'pending' } : item
      )))
      setSaveError(error instanceof Error ? error.message : '保存失败，请重试。')
    } finally {
      setSaving(false)
    }
  }

  const formTitle = initial ? '编辑故事' : importFile ? '导入文件' : '新建故事'
  const hasUploadFailure = attachmentFiles.some((item) => item.status === 'error')

  return (
    <Sheet open={open} onOpenChange={requestClose}>
      <SheetContent>
        <SheetHeader>
          <SheetTitle>{formTitle}</SheetTitle>
          {importFile && (
            <SheetDescription>
              已解析并预填，可修改后保存；原文件将挂为该故事的附件。
            </SheetDescription>
          )}
        </SheetHeader>

        <div className="flex-1 overflow-y-auto p-4">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="m-facets">经历标签</Label>
              <div className="flex min-h-8 w-full flex-wrap items-center gap-1.5 rounded-md border border-input bg-white px-2 py-1.5 focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/50">
                {facets.map((facet) => (
                  <span
                    key={facet}
                    className="flex items-center gap-1 rounded bg-accent px-1.5 py-0.5 text-xs text-accent-foreground"
                  >
                    {facet}
                    <button
                      type="button"
                      aria-label={`删除标签 ${facet}`}
                      className="cursor-pointer"
                      onClick={() => setFacets(facets.filter((item) => item !== facet))}
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
                  onChange={(event) => setFacetInput(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.nativeEvent.isComposing) return
                    if (
                      (event.key === 'Enter' || event.key === ',' || event.key === '，') &&
                      facetInput.trim()
                    ) {
                      event.preventDefault()
                      const value = facetInput.trim()
                      if (!facets.includes(value)) setFacets([...facets, value])
                      setFacetInput('')
                    } else if (event.key === 'Backspace' && !facetInput && facets.length > 0) {
                      setFacets(facets.slice(0, -1))
                    }
                  }}
                />
              </div>
              <p className="text-xs text-muted-foreground">用于素材库顶部的「故事方向」筛选，可回车添加多个。</p>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="m-project">所属项目 *</Label>
              <Input
                id="m-project"
                placeholder="如：电商数据中台"
                value={project}
                onChange={(event) => setProject(event.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="m-title">故事标题 *</Label>
              <Input
                id="m-title"
                placeholder="一句话说清场景"
                value={title}
                onChange={(event) => setTitle(event.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="m-role">担任角色</Label>
              <Input
                id="m-role"
                placeholder="如：数据分析师"
                value={role}
                onChange={(event) => setRole(event.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="m-duration">时间段</Label>
              <Input
                id="m-duration"
                placeholder="如：2023.03–2024.06"
                value={duration}
                onChange={(event) => setDuration(event.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="m-cap1">能力域（capability_l1）</Label>
              <div className="relative">
                <Input
                  id="m-cap1"
                  list="m-cap1-options"
                  placeholder="选择或输入，如：AI 产品"
                  autoComplete="off"
                  maxLength={40}
                  className={capabilityL1 ? 'pr-8' : undefined}
                  value={capabilityL1}
                  onChange={(event) => setCapabilityL1(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.nativeEvent.isComposing) return
                    if (event.key === 'Enter') event.preventDefault()
                  }}
                />
                {capabilityL1 && (
                  <button
                    type="button"
                    aria-label="清空能力域"
                    className="absolute top-1/2 right-2 -translate-y-1/2 rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
                    onClick={() => setCapabilityL1('')}
                  >
                    <X className="size-3.5" />
                  </button>
                )}
                <datalist id="m-cap1-options">
                  {CAPABILITY_L1_OPTIONS.map((option) => <option key={option} value={option} />)}
                </datalist>
              </div>
              <p className="text-xs text-muted-foreground">单值，可选择建议项或自定义，留空则不设置。</p>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="m-cap2">细分能力（capability_l2）</Label>
              <Input
                id="m-cap2"
                placeholder="如：指标体系搭建"
                value={capabilityL2}
                onChange={(event) => setCapabilityL2(event.target.value)}
              />
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="m-tags">自由标签（逗号分隔）</Label>
              <Input
                id="m-tags"
                placeholder="如：SQL, 看板, 北极星指标"
                value={tags}
                onChange={(event) => setTags(event.target.value)}
              />
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="m-metrics">量化成果</Label>
              <Input
                id="m-metrics"
                placeholder="一两个即可，如：报表人力成本下降 60%"
                value={metrics}
                onChange={(event) => setMetrics(event.target.value)}
              />
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="m-content">故事内容（markdown，自由结构）</Label>
              <Textarea
                id="m-content"
                rows={10}
                placeholder="不强制 STAR 四段，按自己的结构写"
                value={content}
                onChange={(event) => setContent(event.target.value)}
              />
            </div>
            <div className="space-y-3 border-t pt-4 sm:col-span-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <p className="text-sm font-medium">相关附件（可选）</p>
                  <p className="mt-1 text-xs text-muted-foreground">单文件最大 25 MB；同名附件保存时替换，不解析或覆盖故事正文。</p>
                </div>
                <Button type="button" variant="outline" size="sm" disabled={saving} onClick={() => fileInputRef.current?.click()}>
                  <Plus />添加附件
                </Button>
                <input ref={fileInputRef} type="file" multiple className="hidden" onChange={onFilesChosen} />
              </div>
              {existingAttachments.length > 0 && (
                <div className="space-y-1.5">
                  {existingAttachments.map((attachment) => (
                    <div key={`existing-${attachment.name}`} className="flex min-w-0 items-center gap-2 text-xs">
                      <Paperclip className="size-3.5 shrink-0 text-muted-foreground" />
                      <span className="min-w-0 flex-1 truncate" title={attachment.name}>{attachment.name}</span>
                      <span className="shrink-0 text-muted-foreground">{formatFileSize(attachment.size)} · 已上传</span>
                    </div>
                  ))}
                </div>
              )}
              {attachmentFiles.map((item) => (
                <div key={item.file.name} className="flex min-w-0 items-center gap-2 text-xs">
                  {item.status === 'uploading' ? <LoaderCircle className="size-3.5 shrink-0 animate-spin text-primary" /> : item.status === 'success' ? <CircleCheck className="size-3.5 shrink-0 text-emerald-600" /> : item.status === 'error' ? <CircleAlert className="size-3.5 shrink-0 text-destructive" /> : <Paperclip className="size-3.5 shrink-0 text-muted-foreground" />}
                  <div className="min-w-0 flex-1">
                    <p className="truncate" title={item.file.name}>{item.file.name}</p>
                    <p className={item.status === 'error' ? 'text-destructive' : 'text-muted-foreground'}>
                      {formatFileSize(item.file.size)} · {{ pending: '待上传', uploading: '上传中', success: '上传成功', error: item.message ?? '上传失败' }[item.status]}
                      {existingAttachments.some((attachment) => attachment.name === item.file.name) && item.status !== 'success' ? ' · 将替换同名附件' : ''}
                    </p>
                  </div>
                  {!saving && item.status !== 'success' && (
                    <button
                      type="button"
                      aria-label={`移除附件 ${item.file.name}`}
                      className="shrink-0 rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
                      onClick={() => setAttachmentFiles((current) => current.filter(({ file }) => file.name !== item.file.name))}
                    >
                      <X className="size-3.5" />
                    </button>
                  )}
                </div>
              ))}
              {existingAttachments.length === 0 && attachmentFiles.length === 0 && (
                <p className="text-xs text-muted-foreground">可在保存故事时一并上传，也可稍后在详情中添加。</p>
              )}
            </div>
          </div>
          {saveError && <p role="alert" className="mt-4 text-sm text-destructive">{saveError}</p>}
        </div>

        <SheetFooter>
          <Button variant="outline" disabled={saving} onClick={() => requestClose(false)}>
            取消
          </Button>
          <Button onClick={() => void handleSave()} disabled={!canSave}>
            {saving ? '保存中…' : hasUploadFailure ? '重试附件上传' : '保存'}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  )
}
