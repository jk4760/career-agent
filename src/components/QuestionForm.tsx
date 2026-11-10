import { useEffect, useState } from 'react'
import { Star } from 'lucide-react'
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
import { QUESTION_CATEGORIES, type InterviewQuestion, type Material } from '@/types'

const NONE = '__none__'

/** 把握度 1–5 星选择器（再点同一颗取消） */
export function ConfidenceStars({
  value,
  onChange,
}: {
  value: number | null
  onChange: (v: number | null) => void
}) {
  return (
    <div className="flex items-center gap-1">
      {[1, 2, 3, 4, 5].map((n) => (
        <button
          key={n}
          type="button"
          className="cursor-pointer rounded-md p-3 outline-none focus-visible:ring-3 focus-visible:ring-ring/50 sm:p-0.5"
          onClick={() => onChange(value === n ? null : n)}
        >
          <Star
            className={`size-5 ${
              value !== null && n <= value
                ? 'fill-amber-400 text-amber-400'
                : 'text-muted-foreground/40'
            }`}
          />
        </button>
      ))}
      <span className="ml-2 text-sm text-muted-foreground">
        {value ? `${value}/5` : '未评估'}
      </span>
    </div>
  )
}

interface QuestionFormProps {
  open: boolean
  materials: Material[]
  onOpenChange: (open: boolean) => void
  onSave: (question: InterviewQuestion) => void
}

/** 「+ 新增问题」表单（§10.10）：分类四类下拉 + 问题 + 回答草稿 + 关联故事 + 把握度 */
export function QuestionForm({ open, materials, onOpenChange, onSave }: QuestionFormProps) {
  const [category, setCategory] = useState<string>(QUESTION_CATEGORIES[0])
  const [question, setQuestion] = useState('')
  const [answerDraft, setAnswerDraft] = useState('')
  const [linkedMaterialId, setLinkedMaterialId] = useState<string>(NONE)
  const [confidence, setConfidence] = useState<number | null>(null)

  useEffect(() => {
    if (!open) return
    setCategory(QUESTION_CATEGORIES[0])
    setQuestion('')
    setAnswerDraft('')
    setLinkedMaterialId(NONE)
    setConfidence(null)
  }, [open])

  const handleSave = () => {
    if (!question.trim()) return
    onSave({
      id: crypto.randomUUID(),
      category,
      question: question.trim(),
      answerDraft: answerDraft.trim() || null,
      linkedMaterialId: linkedMaterialId === NONE ? null : linkedMaterialId,
      confidence,
      updatedAt: new Date().toISOString(),
    })
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>新增问题</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label>分类</Label>
            <Select value={category} onValueChange={(v) => setCategory(v as string)}>
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {QUESTION_CATEGORIES.map((c) => (
                  <SelectItem key={c} value={c}>
                    {c}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="qf-question">问题 *</Label>
            <Input
              id="qf-question"
              placeholder="如：介绍一下你最有挑战的项目"
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="qf-answer">回答草稿（markdown）</Label>
            <Textarea
              id="qf-answer"
              rows={5}
              placeholder="写下这道题的回答思路…"
              value={answerDraft}
              onChange={(e) => setAnswerDraft(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label>关联故事</Label>
            <Select value={linkedMaterialId} onValueChange={(v) => setLinkedMaterialId(v as string)}>
              <SelectTrigger className="w-full">
                <SelectValue>
                  {(v: string) => {
                    if (v === NONE) return '未关联'
                    const m = materials.find((item) => item.id === v)
                    return m ? `${m.project} · ${m.title}` : '未关联'
                  }}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE}>未关联</SelectItem>
                {materials.map((m) => (
                  <SelectItem key={m.id} value={m.id}>
                    {m.project} · {m.title}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>把握度</Label>
            <ConfidenceStars value={confidence} onChange={setConfidence} />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            取消
          </Button>
          <Button onClick={handleSave} disabled={!question.trim()}>
            保存
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
