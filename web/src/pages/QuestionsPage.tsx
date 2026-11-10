import { useCallback, useEffect, useMemo, useState } from 'react'
import { MessagesSquare, Plus, Trash2 } from 'lucide-react'
import { ConfidenceStars, QuestionForm } from '@/components/QuestionForm'
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
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Separator } from '@/components/ui/separator'
import { Textarea } from '@/components/ui/textarea'
import { useRepository } from '@/lib/repository'
import { QUESTION_CATEGORIES, type InterviewQuestion, type Material } from '@/types'

const NONE = '__none__'

interface Draft {
  question: string
  category: string
  answerDraft: string
  linkedMaterialId: string
  confidence: number | null
}

export default function QuestionsPage() {
  const repo = useRepository()
  const [questions, setQuestions] = useState<InterviewQuestion[]>([])
  const [materials, setMaterials] = useState<Material[]>([])
  const [activeCategory, setActiveCategory] = useState<string>(QUESTION_CATEGORIES[0])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [draft, setDraft] = useState<Draft | null>(null)
  const [saved, setSaved] = useState(false)
  const [formOpen, setFormOpen] = useState(false)
  const [deleting, setDeleting] = useState<InterviewQuestion | null>(null)

  const reload = useCallback(async () => {
    const [qs, ms] = await Promise.all([repo.listQuestions(), repo.listMaterials()])
    setQuestions(qs)
    setMaterials(ms)
  }, [repo])

  useEffect(() => {
    void reload()
  }, [reload])

  const byCategory = useMemo(() => {
    const map = new Map<string, InterviewQuestion[]>()
    for (const c of QUESTION_CATEGORIES) map.set(c, [])
    for (const q of questions) {
      const key = q.category && map.has(q.category) ? q.category : '其他'
      map.get(key)!.push(q)
    }
    return map
  }, [questions])

  const visibleQuestions = byCategory.get(activeCategory) ?? []

  // 分类下首次进入时默认选中第一个问题
  useEffect(() => {
    if (selectedId && questions.some((q) => q.id === selectedId)) return
    setSelectedId(visibleQuestions[0]?.id ?? null)
  }, [questions, selectedId, visibleQuestions])

  const selected = questions.find((q) => q.id === selectedId) ?? null

  useEffect(() => {
    if (!selected) {
      setDraft(null)
      return
    }
    setDraft({
      question: selected.question,
      category: selected.category ?? '其他',
      answerDraft: selected.answerDraft ?? '',
      linkedMaterialId: selected.linkedMaterialId ?? NONE,
      confidence: selected.confidence,
    })
  }, [selected])

  const unlinkedCount = questions.filter((q) => !q.linkedMaterialId).length

  // 变更后无需手动 reload：repo 随 App 状态更新生成新实例，effect 会自动重取
  const handleSave = async () => {
    if (!selected || !draft || !draft.question.trim()) return
    await repo.saveQuestion({
      ...selected,
      question: draft.question.trim(),
      category: draft.category,
      answerDraft: draft.answerDraft.trim() || null,
      linkedMaterialId: draft.linkedMaterialId === NONE ? null : draft.linkedMaterialId,
      confidence: draft.confidence,
    })
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }

  const handleCreate = async (question: InterviewQuestion) => {
    await repo.saveQuestion(question)
    setActiveCategory(question.category ?? '其他')
    setSelectedId(question.id)
  }

  const handleDelete = async () => {
    if (!deleting) return
    const wasSelected = deleting.id === selectedId
    await repo.deleteQuestion(deleting.id)
    if (wasSelected) setSelectedId(null)
    setDeleting(null)
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm text-muted-foreground tabular-nums">
          共 {questions.length} 个问题
        </span>
        {unlinkedCount > 0 && (
          <span className="rounded-md bg-status-new/10 px-2 py-0.5 text-xs font-medium text-status-new">
            还有 {unlinkedCount} 个问题未关联故事
          </span>
        )}
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-[260px_1fr]">
        {/* 左栏：新增 + 分类 + 问题列表 */}
        <div className="space-y-3">
          <Button className="w-full" onClick={() => setFormOpen(true)}>
            <Plus className="size-4" />
            新增问题
          </Button>
          <div className="flex flex-wrap gap-1.5 md:flex-col md:items-stretch">
            {QUESTION_CATEGORIES.map((c) => {
              const count = byCategory.get(c)?.length ?? 0
              return (
                <Button
                  key={c}
                  variant={c === activeCategory ? 'secondary' : 'ghost'}
                  size="sm"
                  className="justify-between"
                  onClick={() => {
                    setActiveCategory(c)
                    setSelectedId(null)
                  }}
                >
                  <span>{c}</span>
                  <Badge variant="outline">{count}</Badge>
                </Button>
              )
            })}
          </div>
          <Separator />
          <div className="space-y-1">
            {visibleQuestions.length === 0 && (
              <div className="flex flex-col items-center gap-1.5 rounded-lg border border-dashed px-3 py-8 text-center">
                <MessagesSquare className="size-5 text-muted-foreground" strokeWidth={1.5} />
                <p className="text-sm text-muted-foreground">该分类下暂无问题</p>
              </div>
            )}
            {visibleQuestions.map((q) => (
              <div key={q.id} className="group relative">
                <button
                  type="button"
                  onClick={() => setSelectedId(q.id)}
                  className={`w-full cursor-pointer rounded-md px-2 py-1.5 text-left text-sm outline-none focus-visible:ring-3 focus-visible:ring-ring/50 ${
                    q.id === selectedId
                      ? 'bg-secondary font-medium'
                      : 'text-muted-foreground hover:bg-muted hover:text-foreground'
                  }`}
                >
                  <span className="line-clamp-2 pr-6">{q.question}</span>
                  {!q.linkedMaterialId && (
                    <span className="mt-0.5 inline-block rounded bg-status-new/10 px-1 text-xs text-status-new">
                      未关联故事
                    </span>
                  )}
                </button>
                {/* hover 显示删除图标（§10.10） */}
                <button
                  type="button"
                  aria-label={`删除问题：${q.question}`}
                  className="absolute top-1.5 right-1 cursor-pointer rounded p-1 text-muted-foreground opacity-0 transition-opacity outline-none group-hover:opacity-100 hover:bg-muted hover:text-destructive focus-visible:opacity-100 focus-visible:ring-3 focus-visible:ring-ring/50"
                  onClick={() => setDeleting(q)}
                >
                  <Trash2 className="size-3.5" />
                </button>
              </div>
            ))}
          </div>
        </div>

        {/* 右栏：问题详情（详情区即编辑区，§10.10） */}
        <div className="min-w-0 rounded-lg border bg-card p-4">
          {!selected || !draft ? (
            <div className="flex flex-col items-center justify-center gap-1.5 py-16 text-center">
              <MessagesSquare className="size-6 text-muted-foreground" strokeWidth={1.5} />
              <p className="text-sm text-muted-foreground">从左侧选择一个问题开始编辑</p>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-[1fr_180px]">
                <div className="space-y-1.5">
                  <Label htmlFor="q-text">问题</Label>
                  <Textarea
                    id="q-text"
                    rows={2}
                    value={draft.question}
                    onChange={(e) => {
                      setDraft({ ...draft, question: e.target.value })
                      setSaved(false)
                    }}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>分类</Label>
                  <Select
                    value={draft.category}
                    onValueChange={(v) => {
                      setDraft({ ...draft, category: v as string })
                      setSaved(false)
                    }}
                  >
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
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="q-answer">回答草稿（markdown）</Label>
                <Textarea
                  id="q-answer"
                  rows={8}
                  placeholder="写下这道题的回答思路…"
                  value={draft.answerDraft}
                  onChange={(e) => {
                    setDraft({ ...draft, answerDraft: e.target.value })
                    setSaved(false)
                  }}
                />
              </div>

              <div className="space-y-1.5">
                <Label>关联故事（这道题讲哪个故事）</Label>
                <Select
                  value={draft.linkedMaterialId}
                  onValueChange={(v) => {
                    setDraft({ ...draft, linkedMaterialId: v as string })
                    setSaved(false)
                  }}
                >
                  <SelectTrigger className="w-full max-w-md">
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
                <ConfidenceStars
                  value={draft.confidence}
                  onChange={(v) => {
                    setDraft({ ...draft, confidence: v })
                    setSaved(false)
                  }}
                />
              </div>

              <div className="flex items-center gap-3">
                <Button onClick={handleSave} disabled={!draft.question.trim()}>
                  保存
                </Button>
                {saved && <span className="text-sm font-medium text-status-interested">已保存</span>}
                <span className="text-xs text-muted-foreground">
                  上次更新：{selected.updatedAt.slice(0, 10)}
                </span>
              </div>
            </div>
          )}
        </div>
      </div>

      <QuestionForm
        open={formOpen}
        materials={materials}
        onOpenChange={setFormOpen}
        onSave={handleCreate}
      />

      <AlertDialog
        open={deleting !== null}
        onOpenChange={(open) => {
          if (!open) setDeleting(null)
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>确认删除这个问题？</AlertDialogTitle>
            <AlertDialogDescription>
              「{deleting?.question}」删除后不可恢复，其与故事的关联关系随之消失。
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
