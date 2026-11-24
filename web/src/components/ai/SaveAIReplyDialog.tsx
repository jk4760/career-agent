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
import { saveAIMessage } from '@/lib/aiApi'
import {
  CAPABILITY_L1_OPTIONS,
  QUESTION_CATEGORIES,
  type AIMessage,
  type AISaveResult,
  type AISaveTargetType,
  type Material,
} from '@/types'

const NONE = '__none__'

function compact(value: string, maxLength: number) {
  return value.trim().replace(/\s+/g, ' ').slice(0, maxLength)
}

interface Props {
  message: AIMessage | null
  targetType: AISaveTargetType | null
  sourceQuestion: string
  materials: Material[]
  onClose: () => void
  onView: (result: AISaveResult) => void
}

export function SaveAIReplyDialog({ message, targetType, sourceQuestion, materials, onClose, onView }: Props) {
  const [project, setProject] = useState('AI 对话沉淀')
  const [title, setTitle] = useState('')
  const [facets, setFacets] = useState('')
  const [capabilityL1, setCapabilityL1] = useState('')
  const [capabilityL2, setCapabilityL2] = useState('')
  const [metrics, setMetrics] = useState('')
  const [content, setContent] = useState('')
  const [category, setCategory] = useState('其他')
  const [question, setQuestion] = useState('')
  const [answerDraft, setAnswerDraft] = useState('')
  const [linkedMaterialId, setLinkedMaterialId] = useState(NONE)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState<AISaveResult | null>(null)

  useEffect(() => {
    if (!message || !targetType) return
    setProject('AI 对话沉淀')
    setTitle(compact(sourceQuestion, 60) || 'AI 回复草稿')
    setFacets('')
    setCapabilityL1('')
    setCapabilityL2('')
    setMetrics('')
    setContent(message.content)
    setCategory('其他')
    setQuestion(compact(sourceQuestion, 200) || 'AI 回复草稿')
    setAnswerDraft(message.content)
    setLinkedMaterialId(NONE)
    setSaving(false)
    setError(null)
    setSaved(null)
  }, [message, targetType, sourceQuestion])

  const valid = targetType === 'material'
    ? Boolean(project.trim() && title.trim() && content.trim())
    : Boolean(question.trim() && answerDraft.trim())

  const save = async () => {
    if (!message || !targetType || !valid) return
    setSaving(true)
    setError(null)
    try {
      const result = await saveAIMessage(message.id, targetType === 'material'
        ? {
            targetType,
            data: {
              project: project.trim(),
              title: title.trim(),
              facets: facets.split(/[,，]/).map((item) => item.trim()).filter(Boolean).slice(0, 10),
              capabilityL1: capabilityL1.trim() || null,
              capabilityL2: capabilityL2.trim() || null,
              metrics: metrics.trim() || null,
              content: content.trim(),
            },
          }
        : {
            targetType,
            data: {
              category,
              question: question.trim(),
              answerDraft: answerDraft.trim(),
              linkedMaterialId: linkedMaterialId === NONE ? null : linkedMaterialId,
            },
          })
      setSaved(result)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '保存失败，请重试。')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={Boolean(message && targetType)} onOpenChange={(open) => { if (!open) onClose() }}>
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{targetType === 'material' ? '保存为素材' : '保存为问答'}</DialogTitle>
          <DialogDescription>AI 生成草稿，编辑并确认后才会写入{targetType === 'material' ? '素材库' : '问题库'}。保存过程不调用模型。</DialogDescription>
        </DialogHeader>
        {saved ? (
          <div className="space-y-3 rounded-md bg-emerald-50 p-4 text-sm text-emerald-900">
            <p className="font-medium">{saved.existing ? '这条回复此前已保存，未创建重复记录。' : '已保存，来源信息已一并记录。'}</p>
            <p className="text-xs">来源：{saved.source.provider} / {saved.source.model} · {saved.source.savedAt.slice(0, 16).replace('T', ' ')}</p>
          </div>
        ) : targetType === 'material' ? (
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="save-ai-project">所属项目 *</Label>
              <Input id="save-ai-project" maxLength={100} value={project} onChange={(event) => setProject(event.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="save-ai-title">故事标题 *</Label>
              <Input id="save-ai-title" maxLength={200} value={title} onChange={(event) => setTitle(event.target.value)} />
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="save-ai-facets">经历标签（逗号分隔）</Label>
              <Input id="save-ai-facets" placeholder="用于故事方向筛选，可留空" value={facets} onChange={(event) => setFacets(event.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="save-ai-cap1">能力域</Label>
              <Input id="save-ai-cap1" list="save-ai-cap1-options" maxLength={40} placeholder="选择或自定义" value={capabilityL1} onChange={(event) => setCapabilityL1(event.target.value)} />
              <datalist id="save-ai-cap1-options">
                {CAPABILITY_L1_OPTIONS.map((option) => <option key={option} value={option} />)}
              </datalist>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="save-ai-cap2">细分能力</Label>
              <Input id="save-ai-cap2" maxLength={80} value={capabilityL2} onChange={(event) => setCapabilityL2(event.target.value)} />
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="save-ai-metrics">量化成果</Label>
              <Input id="save-ai-metrics" maxLength={500} placeholder="请只填写你确认真实的成果" value={metrics} onChange={(event) => setMetrics(event.target.value)} />
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="save-ai-content">故事正文 *</Label>
              <Textarea id="save-ai-content" rows={12} maxLength={30000} value={content} onChange={(event) => setContent(event.target.value)} />
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label>分类</Label>
              <Select value={category} onValueChange={(value) => setCategory(value as string)}>
                <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {QUESTION_CATEGORIES.map((item) => <SelectItem key={item} value={item}>{item}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="save-ai-question">问题 *</Label>
              <Input id="save-ai-question" maxLength={500} value={question} onChange={(event) => setQuestion(event.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="save-ai-answer">回答草稿 *</Label>
              <Textarea id="save-ai-answer" rows={12} maxLength={30000} value={answerDraft} onChange={(event) => setAnswerDraft(event.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label>关联素材（可选）</Label>
              <Select value={linkedMaterialId} onValueChange={(value) => setLinkedMaterialId(value as string)}>
                <SelectTrigger className="w-full">
                  <SelectValue>{(value: string) => {
                    if (value === NONE) return '不关联'
                    const material = materials.find((item) => item.id === value)
                    return material ? `${material.project} · ${material.title}` : '不关联'
                  }}</SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>不关联</SelectItem>
                  {materials.map((material) => <SelectItem key={material.id} value={material.id}>{material.project} · {material.title}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>
        )}
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        <DialogFooter>
          {saved ? (
            <>
              <Button variant="outline" onClick={onClose}>关闭</Button>
              <Button onClick={() => onView(saved)}>{saved.targetType === 'material' ? '查看素材' : '查看问答'}</Button>
            </>
          ) : (
            <>
              <Button variant="outline" disabled={saving} onClick={onClose}>取消</Button>
              <Button disabled={!valid || saving} onClick={() => void save()}>{saving ? '保存中…' : '确认保存'}</Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
