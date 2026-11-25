import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import {
  Bold,
  Check,
  Code2,
  Heading3,
  Italic,
  LayoutGrid,
  Link2,
  List,
  MessagesSquare,
  Pencil,
  Plus,
  Quote,
  Save,
  Search,
  Star,
  Target,
  Trash2,
  Users,
  type LucideIcon,
} from 'lucide-react'
import { MarkdownContent } from '@/components/MarkdownContent'
import { AISourceNote } from '@/components/AISourceNote'
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
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { useRepository } from '@/lib/repository'
import { cn } from '@/lib/utils'
import { QUESTION_CATEGORIES, type InterviewQuestion, type Material } from '@/types'

const NONE = '__none__'
const CATEGORY_ICONS: Record<string, LucideIcon> = {
  项目深挖: Target,
  行为面: Users,
  技术概念: Code2,
  其他: LayoutGrid,
}
const CONFIDENCE_LABELS = ['未评估', '需要梳理', '有些印象', '基本清楚', '比较熟悉', '非常熟悉']

interface Draft {
  question: string
  category: string
  answerDraft: string
  linkedMaterialId: string
  confidence: number | null
}

function QuestionStars({ value }: { value: number | null }) {
  return (
    <span className="flex items-center gap-0.5" aria-label={value ? `把握度 ${value}/5` : '未评估把握度'}>
      {[1, 2, 3, 4, 5].map((number) => (
        <Star
          key={number}
          className={cn(
            'size-3.5',
            value !== null && number <= value
              ? 'fill-amber-400 text-amber-400'
              : 'text-slate-300',
          )}
        />
      ))}
    </span>
  )
}

export default function QuestionsPage() {
  const repo = useRepository()
  const [searchParams] = useSearchParams()
  const [questions, setQuestions] = useState<InterviewQuestion[]>([])
  const [materials, setMaterials] = useState<Material[]>([])
  const [loading, setLoading] = useState(true)
  const [activeCategory, setActiveCategory] = useState<string>(QUESTION_CATEGORIES[0])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [draft, setDraft] = useState<Draft | null>(null)
  const [answerMode, setAnswerMode] = useState<'edit' | 'preview'>('edit')
  const [editingQuestion, setEditingQuestion] = useState(false)
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')
  const [formOpen, setFormOpen] = useState(false)
  const [deleting, setDeleting] = useState<InterviewQuestion | null>(null)
  const answerRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    void Promise.all([repo.listQuestions(), repo.listMaterials()]).then(([nextQuestions, nextMaterials]) => {
      setQuestions(nextQuestions)
      setMaterials(nextMaterials)
      setLoading(false)
    })
  }, [repo, searchParams])

  const byCategory = useMemo(() => {
    const map = new Map<string, InterviewQuestion[]>()
    for (const category of QUESTION_CATEGORIES) map.set(category, [])
    for (const question of questions) {
      const category = question.category && map.has(question.category) ? question.category : '其他'
      map.get(category)!.push(question)
    }
    return map
  }, [questions])

  const categoryQuestions = useMemo(
    () => byCategory.get(activeCategory) ?? [],
    [activeCategory, byCategory],
  )
  const visibleQuestions = categoryQuestions.filter((question) =>
    question.question.toLowerCase().includes(search.trim().toLowerCase()),
  )

  useEffect(() => {
    if (selectedId && categoryQuestions.some((question) => question.id === selectedId)) return
    setSelectedId(categoryQuestions[0]?.id ?? null)
  }, [categoryQuestions, selectedId])

  const selected = questions.find((question) => question.id === selectedId) ?? null

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
    setEditingQuestion(false)
    setAnswerMode('edit')
    setSaveState('idle')
  }, [selected])

  useEffect(() => {
    const focus = searchParams.get('focus')
    const target = questions.find((question) => question.id === focus)
    if (target) {
      setActiveCategory(target.category ?? '其他')
      setSelectedId(target.id)
    }
  }, [questions, searchParams])

  const dirty = Boolean(
    selected &&
      draft &&
      (draft.question !== selected.question ||
        draft.category !== (selected.category ?? '其他') ||
        draft.answerDraft !== (selected.answerDraft ?? '') ||
        draft.linkedMaterialId !== (selected.linkedMaterialId ?? NONE) ||
        draft.confidence !== selected.confidence),
  )

  const updateDraft = (patch: Partial<Draft>) => {
    setDraft((current) => (current ? { ...current, ...patch } : current))
    setSaveState('idle')
  }

  const handleSave = useCallback(async () => {
    if (!selected || !draft || !draft.question.trim()) return
    setSaveState('saving')
    try {
      const saved = await repo.saveQuestion({
        ...selected,
        question: draft.question.trim(),
        category: draft.category,
        answerDraft: draft.answerDraft.trim() || null,
        linkedMaterialId: draft.linkedMaterialId === NONE ? null : draft.linkedMaterialId,
        confidence: draft.confidence,
      })
      setQuestions((current) => current.map((question) => (question.id === saved.id ? saved : question)))
      setActiveCategory(saved.category ?? '其他')
      setSaveState('saved')
    } catch {
      setSaveState('error')
    }
  }, [draft, repo, selected])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 's') {
        event.preventDefault()
        void handleSave()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [handleSave])

  const discardAnd = (action: () => void) => {
    if (dirty && !window.confirm('当前问题有未保存的修改，放弃修改并继续？')) return
    action()
  }

  const handleCreate = async (question: InterviewQuestion) => {
    const saved = await repo.saveQuestion(question)
    setQuestions((current) => [...current, saved])
    setActiveCategory(saved.category ?? '其他')
    setSelectedId(saved.id)
  }

  const handleDelete = async () => {
    if (!deleting) return
    await repo.deleteQuestion(deleting.id)
    setQuestions((current) => current.filter((question) => question.id !== deleting.id))
    if (deleting.id === selectedId) setSelectedId(null)
    setDeleting(null)
  }

  const applyMarkdown = (type: 'heading' | 'bold' | 'italic' | 'list' | 'quote' | 'link') => {
    if (!draft) return
    const textarea = answerRef.current
    const start = textarea?.selectionStart ?? draft.answerDraft.length
    const end = textarea?.selectionEnd ?? draft.answerDraft.length
    const selectedText = draft.answerDraft.slice(start, end)
    let replacement = selectedText
    let selectionStart = start
    let selectionEnd = end

    if (type === 'bold' || type === 'italic') {
      const marker = type === 'bold' ? '**' : '*'
      const content = selectedText || (type === 'bold' ? '重点内容' : '强调内容')
      replacement = `${marker}${content}${marker}`
      selectionStart = start + marker.length
      selectionEnd = selectionStart + content.length
    } else if (type === 'link') {
      const content = selectedText || '链接文字'
      replacement = `[${content}](https://)`
      selectionStart = start + 1
      selectionEnd = selectionStart + content.length
    } else {
      const prefix = type === 'heading' ? '### ' : type === 'list' ? '- ' : '> '
      const content = selectedText || (type === 'heading' ? '小标题' : type === 'list' ? '列表项' : '引用内容')
      replacement = content
        .split('\n')
        .map((line) => `${prefix}${line}`)
        .join('\n')
      selectionStart = start + replacement.length
      selectionEnd = selectionStart
    }

    updateDraft({
      answerDraft:
        draft.answerDraft.slice(0, start) + replacement + draft.answerDraft.slice(end),
    })
    requestAnimationFrame(() => {
      textarea?.focus()
      textarea?.setSelectionRange(selectionStart, selectionEnd)
    })
  }

  const selectedIndex = selected
    ? categoryQuestions.findIndex((question) => question.id === selected.id)
    : -1

  return (
    <div className="@container">
      <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2.5">
            <h2 className="text-[22px] font-semibold tracking-[-0.02em]">问题库</h2>
            <span className="rounded-md bg-muted px-2 py-0.5 text-xs text-muted-foreground tabular-nums">
              {questions.length} 个问题
            </span>
          </div>
          <p className="mt-1 text-sm text-muted-foreground">选一个问题，把经历组织成有说服力的回答。</p>
        </div>
        <Button className="mt-1" onClick={() => setFormOpen(true)}>
          <Plus />
          新增问题
        </Button>
      </div>

      <section className="overflow-hidden rounded-lg border bg-card">
        <nav className="flex items-center gap-1 overflow-x-auto border-b px-3" aria-label="问题分类">
          {QUESTION_CATEGORIES.map((category) => {
            const Icon = CATEGORY_ICONS[category]
            const active = category === activeCategory
            return (
              <button
                key={category}
                type="button"
                className={cn(
                  'flex shrink-0 cursor-pointer items-center gap-1.5 border-b-2 px-3 py-3 text-sm outline-none transition-colors focus-visible:bg-muted',
                  active
                    ? 'border-primary font-medium text-primary'
                    : 'border-transparent text-slate-500 hover:text-slate-800',
                )}
                onClick={() =>
                  discardAnd(() => {
                    setActiveCategory(category)
                    setSelectedId(byCategory.get(category)?.[0]?.id ?? null)
                  })
                }
                aria-current={active ? 'page' : undefined}
              >
                <Icon className={cn('size-4', !active && 'text-slate-400')} />
                {category}
                <span
                  className={cn(
                    'rounded bg-muted px-1.5 text-[11px] text-muted-foreground tabular-nums',
                    active && 'bg-blue-100 text-blue-700',
                  )}
                >
                  {byCategory.get(category)?.length ?? 0}
                </span>
              </button>
            )
          })}
        </nav>

        <div className="grid grid-cols-1 @min-[900px]:grid-cols-[340px_minmax(0,1fr)]">
          <aside className="flex min-h-80 flex-col border-b @min-[900px]:border-r @min-[900px]:border-b-0">
            <div className="border-b px-4 py-3">
              <div className="mb-2.5 flex items-baseline justify-between">
                <h3 className="text-sm font-semibold">{activeCategory}</h3>
                <span className="text-xs text-muted-foreground tabular-nums">
                  {categoryQuestions.length} 个问题
                </span>
              </div>
              <div className="relative">
                <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  className="border-0 bg-muted/70 pl-8 shadow-none focus-visible:ring-2"
                  placeholder="搜索当前分类的问题…"
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                />
              </div>
            </div>

            <div className="flex-1">
              {loading ? (
                <p className="px-4 py-12 text-center text-sm text-muted-foreground">正在加载问题…</p>
              ) : visibleQuestions.length === 0 ? (
                <div className="flex flex-col items-center gap-2 px-4 py-12 text-center">
                  <MessagesSquare className="size-5 text-muted-foreground" strokeWidth={1.5} />
                  <p className="text-sm text-muted-foreground">
                    {search ? '没有匹配的问题' : '该分类下暂无问题'}
                  </p>
                </div>
              ) : (
                visibleQuestions.map((question) => {
                  const active = question.id === selectedId
                  const questionNumber =
                    categoryQuestions.findIndex((item) => item.id === question.id) + 1
                  return (
                    <button
                      key={question.id}
                      type="button"
                      className={cn(
                        'relative flex w-full cursor-pointer flex-col gap-1.5 border-b px-4 py-3.5 text-left outline-none transition-colors last:border-0 hover:bg-slate-50/80 focus-visible:ring-3 focus-visible:ring-inset focus-visible:ring-ring/50',
                        active && 'bg-blue-50/70',
                      )}
                      onClick={() =>
                        discardAnd(() => {
                          setSelectedId(question.id)
                        })
                      }
                    >
                      {active && <span className="absolute inset-y-0 left-0 w-[3px] bg-primary" />}
                      <span className="flex items-center justify-between text-[11px]">
                        <span className={cn('font-medium', active ? 'text-primary' : 'text-muted-foreground')}>
                          问题 {String(questionNumber).padStart(2, '0')}
                        </span>
                        {active && <span className="text-primary">当前编辑</span>}
                      </span>
                      <span
                        className={cn(
                          'line-clamp-2 text-[13px] font-medium leading-snug',
                          active ? 'text-blue-950' : 'text-slate-700',
                        )}
                      >
                        {question.question}
                      </span>
                      <span className="flex items-center justify-between gap-2 text-xs">
                        <QuestionStars value={question.confidence} />
                        {question.linkedMaterialId ? (
                          <span className="flex items-center gap-1 text-muted-foreground">
                            <Link2 className="size-3" />
                            已关联故事
                          </span>
                        ) : (
                          <span className="flex items-center gap-1 text-amber-700">
                            <Link2 className="size-3" />
                            未关联故事
                          </span>
                        )}
                      </span>
                    </button>
                  )
                })
              )}
            </div>
            <div className="border-t px-4 py-2.5 text-center text-xs text-muted-foreground">
              选择一个问题，在右侧完善回答
            </div>
          </aside>

          <article className="flex min-w-0 flex-col @min-[900px]:min-h-[560px]">
            {!selected || !draft ? (
              <div className="flex flex-1 flex-col items-center justify-center gap-3 px-6 py-20 text-center">
                <MessagesSquare className="size-7 text-muted-foreground" strokeWidth={1.5} />
                <p className="text-sm text-muted-foreground">
                  {loading ? '正在加载问题…' : '当前分类还没有问题'}
                </p>
                {!loading && (
                  <Button onClick={() => setFormOpen(true)}>
                    <Plus />
                    新增问题
                  </Button>
                )}
              </div>
            ) : (
              <>
                <div className="flex items-center justify-between border-b px-5 py-2.5 text-xs text-muted-foreground">
                  <span>
                    {activeCategory} <span className="mx-1.5 text-border">/</span> 问题{' '}
                    {String(selectedIndex + 1).padStart(2, '0')}
                  </span>
                  <span className="flex gap-1">
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label={editingQuestion ? '收起问题编辑' : '编辑问题文本'}
                      title="编辑问题文本"
                      onClick={() => setEditingQuestion(!editingQuestion)}
                    >
                      <Pencil />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label="删除当前问题"
                      title="删除问题"
                      onClick={() => setDeleting(selected)}
                    >
                      <Trash2 className="text-muted-foreground hover:text-destructive" />
                    </Button>
                  </span>
                </div>

                <div className="flex-1 space-y-4 px-5 py-4">
                  {editingQuestion ? (
                    <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_140px]">
                      <Textarea
                        aria-label="问题文本"
                        rows={2}
                        value={draft.question}
                        onChange={(event) => updateDraft({ question: event.target.value })}
                      />
                      <Select
                        value={draft.category}
                        onValueChange={(value) => updateDraft({ category: value as string })}
                      >
                        <SelectTrigger className="w-full self-start">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {QUESTION_CATEGORIES.map((category) => (
                            <SelectItem key={category} value={category}>
                              {category}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  ) : (
                    <h3 className="text-[17px] font-semibold leading-snug">{draft.question}</h3>
                  )}

                  <AISourceNote source={selected.aiSource} />
                  <div>
                    <div className="mb-1.5 flex items-center justify-between">
                      <span className="text-xs font-medium text-slate-500">回答草稿</span>
                      <span className="text-xs text-muted-foreground">支持 Markdown</span>
                    </div>
                    <div className="overflow-hidden rounded-lg border">
                      <div className="flex flex-wrap items-center justify-between gap-2 border-b bg-slate-50/70 px-2 py-1">
                        <div className="flex items-center gap-0.5 text-slate-500">
                          <Button
                            variant="ghost"
                            size="icon-xs"
                            title="三级标题"
                            aria-label="插入三级标题"
                            onMouseDown={(event) => event.preventDefault()}
                            onClick={() => applyMarkdown('heading')}
                          >
                            <Heading3 />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon-xs"
                            title="加粗"
                            aria-label="加粗选中文字"
                            onMouseDown={(event) => event.preventDefault()}
                            onClick={() => applyMarkdown('bold')}
                          >
                            <Bold />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon-xs"
                            title="斜体"
                            aria-label="斜体选中文字"
                            onMouseDown={(event) => event.preventDefault()}
                            onClick={() => applyMarkdown('italic')}
                          >
                            <Italic />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon-xs"
                            title="列表"
                            aria-label="插入列表"
                            onMouseDown={(event) => event.preventDefault()}
                            onClick={() => applyMarkdown('list')}
                          >
                            <List />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon-xs"
                            title="引用"
                            aria-label="插入引用"
                            onMouseDown={(event) => event.preventDefault()}
                            onClick={() => applyMarkdown('quote')}
                          >
                            <Quote />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon-xs"
                            title="链接"
                            aria-label="插入链接"
                            onMouseDown={(event) => event.preventDefault()}
                            onClick={() => applyMarkdown('link')}
                          >
                            <Link2 />
                          </Button>
                        </div>
                        <div className="flex rounded-md border bg-white p-0.5 text-xs">
                          <button
                            type="button"
                            className={cn(
                              'cursor-pointer rounded px-2.5 py-1',
                              answerMode === 'edit' ? 'bg-primary text-white' : 'text-slate-500',
                            )}
                            onClick={() => setAnswerMode('edit')}
                          >
                            编辑
                          </button>
                          <button
                            type="button"
                            className={cn(
                              'cursor-pointer rounded px-2.5 py-1',
                              answerMode === 'preview' ? 'bg-primary text-white' : 'text-slate-500',
                            )}
                            onClick={() => setAnswerMode('preview')}
                          >
                            预览
                          </button>
                        </div>
                      </div>

                      {answerMode === 'edit' ? (
                        <textarea
                          ref={answerRef}
                          className="min-h-52 w-full resize-y border-0 bg-white p-3 text-sm leading-relaxed outline-none placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/40"
                          placeholder={'先说结论，再用具体经历展开。\n\n可以从背景、行动、结果和反思开始…'}
                          value={draft.answerDraft}
                          onChange={(event) => updateDraft({ answerDraft: event.target.value })}
                        />
                      ) : (
                        <div className="min-h-52 p-3">
                          {draft.answerDraft ? (
                            <MarkdownContent content={draft.answerDraft} />
                          ) : (
                            <p className="text-sm text-muted-foreground">暂无回答，切换到编辑开始撰写。</p>
                          )}
                        </div>
                      )}
                      <div className="flex items-center justify-between border-t px-3 py-1.5 text-xs text-muted-foreground">
                        <span>先还原事实，再组织表达</span>
                        <span className="tabular-nums">{draft.answerDraft.replace(/\s/g, '').length} 字</span>
                      </div>
                    </div>
                  </div>

                  <div className="grid gap-4 sm:grid-cols-2">
                    <div>
                      <label className="mb-1.5 flex items-center gap-1 text-xs font-medium text-slate-500">
                        <Link2 className="size-3.5" />
                        关联素材故事
                      </label>
                      <Select
                        value={draft.linkedMaterialId}
                        onValueChange={(value) => updateDraft({ linkedMaterialId: value as string })}
                      >
                        <SelectTrigger
                          className={cn(
                            'w-full',
                            draft.linkedMaterialId === NONE && 'border-amber-200 bg-amber-50/60 text-amber-800',
                          )}
                        >
                          <SelectValue>
                            {(value: string) => {
                              if (value === NONE) return '未关联 · 选择一个故事支撑回答'
                              const material = materials.find((item) => item.id === value)
                              return material ? `${material.project} · ${material.title}` : '未关联'
                            }}
                          </SelectValue>
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value={NONE}>未关联 · 选择一个故事支撑回答</SelectItem>
                          {materials.map((material) => (
                            <SelectItem key={material.id} value={material.id}>
                              {material.project} · {material.title}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div>
                      <span className="mb-1.5 flex items-center gap-1 text-xs font-medium text-slate-500">
                        <Target className="size-3.5" />
                        把握度
                      </span>
                      <div className="flex min-h-8 items-center">
                        <ConfidenceStars
                          value={draft.confidence}
                          onChange={(value) => updateDraft({ confidence: value })}
                        />
                        {draft.confidence !== null && (
                          <span className="ml-2 hidden text-xs text-muted-foreground lg:inline">
                            {CONFIDENCE_LABELS[draft.confidence]}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                </div>

                <div className="flex flex-wrap items-center justify-between gap-3 border-t px-5 py-3">
                  <span
                    className={cn(
                      'flex items-center gap-1.5 text-xs',
                      dirty && 'text-amber-700',
                      !dirty && saveState === 'error' && 'text-destructive',
                      !dirty && saveState !== 'error' && 'text-muted-foreground',
                    )}
                  >
                    {saveState === 'saving' ? (
                      '正在保存…'
                    ) : saveState === 'error' ? (
                      '保存失败，请重试'
                    ) : dirty ? (
                      <>
                        <span className="size-1.5 rounded-full bg-amber-500" />
                        有未保存的修改
                      </>
                    ) : (
                      <>
                        <Check className="size-3.5 text-status-interested" />
                        已保存 · {selected.updatedAt.slice(0, 10).replaceAll('-', '.')} 更新
                      </>
                    )}
                  </span>
                  <Button onClick={handleSave} disabled={saveState === 'saving' || !draft.question.trim()}>
                    <Save />
                    保存回答
                    <kbd className="ml-1 rounded bg-blue-500 px-1 text-[10px] font-normal">⌘ S</kbd>
                  </Button>
                </div>
              </>
            )}
          </article>
        </div>
      </section>
      <p className="mt-3 text-xs text-muted-foreground">
        修改保存在问题库；关联的故事可在素材库中继续维护。
      </p>

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
