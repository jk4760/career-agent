import { useCallback, useEffect, useState } from 'react'
import { ArrowRight, FileText, History, LoaderCircle, RefreshCw, Search } from 'lucide-react'
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
import { useRepository } from '@/lib/repository'
import {
  cancelResumeReport,
  generateResumeReport,
  getReportHistory,
  getReportState,
  saveReportBasis,
  type ReportRow,
  type ReportState,
} from '@/lib/reportApi'
import { cn } from '@/lib/utils'
import type { AIContextSelection, Material, Preferences } from '@/types'

interface Props {
  refreshKey: unknown
  basisSignal?: number
  onOpenReport: (id: string) => void
}

export function ReportCard({ refreshKey, basisSignal = 0, onOpenReport }: Props) {
  const repo = useRepository()
  const [state, setState] = useState<ReportState | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [draft, setDraft] = useState<AIContextSelection | null>(null)
  const [materials, setMaterials] = useState<Material[]>([])
  const [prefs, setPrefs] = useState<Preferences | null>(null)
  const [search, setSearch] = useState('')
  const [saving, setSaving] = useState(false)
  const [history, setHistory] = useState<ReportRow[]>([])
  const [historyOpen, setHistoryOpen] = useState(false)

  const load = useCallback(async () => {
    try {
      setState(await getReportState())
    } catch (err) {
      setError(err instanceof Error ? err.message : '报告状态读取失败')
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load, refreshKey])

  useEffect(() => {
    if (!state?.generating) return
    const timer = setInterval(() => void load(), 2000)
    return () => clearInterval(timer)
  }, [load, state?.generating])

  const openBasis = async () => {
    if (!state) return
    setError(null)
    setDraft(state.selection)
    setSearch('')
    const [ms, p] = await Promise.all([repo.listMaterials(), repo.getPreferences()])
    setMaterials(ms)
    setPrefs(p)
    setDialogOpen(true)
  }

  useEffect(() => {
    if (basisSignal > 0) void openBasis()
  }, [basisSignal])

  const applyBasis = async () => {
    if (!draft) return
    setSaving(true)
    setError(null)
    try {
      setState(await saveReportBasis(draft))
      setDialogOpen(false)
    } catch (err) {
      setError(err instanceof Error ? err.message : '依据保存失败')
    } finally {
      setSaving(false)
    }
  }

  const generate = async () => {
    if (!draft || saving) return
    setSaving(true)
    setError(null)
    try {
      await saveReportBasis(draft)
      await generateResumeReport(draft)
      setDialogOpen(false)
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : '报告生成失败')
    } finally {
      setSaving(false)
    }
  }

  const toggleMaterial = (id: string) => {
    if (!draft) return
    if (draft.materialIds.includes(id)) {
      setDraft({ ...draft, materialIds: draft.materialIds.filter((item) => item !== id) })
    } else if (draft.materialIds.length < 3) {
      setDraft({ ...draft, materialIds: [...draft.materialIds, id] })
    }
  }

  const showHistory = async () => {
    setHistory(await getReportHistory())
    setHistoryOpen((value) => !value)
  }

  if (!state?.enabled) return null
  const current = state.current
  const content = current?.report
  const generating = state.generating
  const disabled = state.budget.exhausted || state.dailyUsed >= state.dailyLimit
  const latestFailure = state.latestTask && ['error', 'truncated', 'canceled'].includes(state.latestTask.status)
    ? state.latestTask
    : null
  const filteredMaterials = materials.filter((material) =>
    [material.title, material.project, ...material.tags, ...material.facets]
      .join(' ').toLowerCase().includes(search.trim().toLowerCase()),
  )
  const changeCount = state.diff.added_job_ids.length + state.diff.removed_job_ids.length + state.diff.changed_job_ids.length

  return (
    <section className="mb-4 rounded-lg border bg-card p-4">
      <div className="flex items-center gap-2">
        <FileText className="size-4 text-primary" />
        <h2 className="text-sm font-semibold">简历方向建议</h2>
        <span className={cn('rounded bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground', generating && 'bg-accent text-accent-foreground', state.stale && 'bg-amber-50 text-amber-700', content && !state.stale && !generating && 'bg-emerald-50 text-emerald-700')}>
          {generating ? '生成中' : state.stale ? '依据已变化' : content ? '已生成' : '未生成'}
        </span>
        <span className="ml-auto text-[11px] text-muted-foreground">{current?.completedAt?.slice(0, 16).replace('T', ' ')}</span>
      </div>

      {generating ? (
        <div className="mt-4">
          <p className="flex items-center gap-2 text-sm font-medium"><LoaderCircle className="size-4 animate-spin text-primary" />正在归纳岗位要求，匹配经历与证据…</p>
          <p className="mt-1 text-xs text-muted-foreground">本次使用 {generating.sourceJobIds.length} 个岗位 · 当前简历 · {generating.selection.materialIds.length} 个素材</p>
          <div className="mt-3 flex gap-2">
            <Button variant="outline" size="sm" onClick={() => { if (window.confirm('确认取消本次生成？旧报告会保留。')) void cancelResumeReport(generating.id).then(load) }}>取消生成</Button>
            {current && <Button variant="ghost" size="sm" onClick={() => onOpenReport(current.id)}>查看上次报告</Button>}
          </div>
        </div>
      ) : state.interestedCount === 0 ? (
        <div className="mt-4">
          <p className="text-sm font-medium">还没有有效的感兴趣岗位</p>
          <p className="mt-1 text-xs text-muted-foreground">先标记感兴趣的岗位，再生成方向建议。</p>
          {current && <Button className="mt-3" variant="outline" size="sm" onClick={() => onOpenReport(current.id)}>查看上次报告</Button>}
        </div>
      ) : content ? (
        <div className="mt-3">
          <h3 className="text-lg font-semibold">建议准备 {content.resume_count} 份方向性简历</h3>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {content.directions.map((direction) => <span key={direction.name} className="rounded bg-accent px-2 py-1 text-xs text-accent-foreground">{direction.name}</span>)}
          </div>
          <p className="mt-3 text-xs text-muted-foreground">基于 {content.source_summary.interested_job_count} 个感兴趣岗位 · 当前简历 · {content.source_summary.material_count} 个素材</p>
          {state.stale && <p className="mt-2 text-xs text-amber-700">检测到 {changeCount} 项岗位依据变化；当前展示的是上次成功报告。</p>}
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <Button size="sm" onClick={() => onOpenReport(current.id)}>查看建议 <ArrowRight /></Button>
            <Button variant="ghost" size="sm" onClick={openBasis} disabled={disabled}><RefreshCw />更新建议</Button>
            <Button variant="link" size="sm" onClick={showHistory}><History />历史报告</Button>
          </div>
        </div>
      ) : (
        <div className="mt-3">
          <p className="text-sm font-medium">根据感兴趣岗位，规划简历准备方向</p>
          <p className="mt-1 max-w-xl text-xs leading-relaxed text-muted-foreground">结合当前有效岗位、当前简历和你选择的素材，给出建议准备的简历份数，以及每份需要突出的能力与经历。</p>
          <div className="mt-3 flex items-center justify-between gap-3">
            <span className="text-xs text-muted-foreground">当前可分析：{state.interestedCount} 个有效感兴趣岗位 · 当前简历 · 素材待选择</span>
            <Button size="sm" onClick={openBasis} disabled={disabled || !state.resumeAvailable}>生成建议 <ArrowRight /></Button>
          </div>
          {state.interestedCount <= 2 && <p className="mt-2 text-[11px] text-muted-foreground">样本较少，仅生成初步观察</p>}
        </div>
      )}

      {!state.resumeAvailable && <p className="mt-3 text-xs text-destructive">当前简历为空，请先在偏好设置中填写个人背景。</p>}
      {disabled && <p className="mt-3 text-xs text-amber-700">{state.budget.exhausted ? '今日模型预算已用完，历史报告仍可查看。' : '今日报告生成／更新已达 3 次。'}</p>}
      {latestFailure && <p className="mt-3 text-xs text-destructive">最近一次任务{latestFailure.status === 'canceled' ? '已取消' : latestFailure.status === 'truncated' ? '因输出上限被截断' : '失败'}；上一份成功报告不受影响。</p>}
      {error && <p className="mt-3 text-xs text-destructive">{error}</p>}

      {historyOpen && (
        <div className="mt-4 border-t pt-3">
          <h3 className="mb-2 text-xs font-semibold">历史报告</h3>
          <div className="space-y-1">
            {history.map((item) => (
              <button key={item.id} type="button" className="flex w-full items-center justify-between rounded px-2 py-1.5 text-left text-xs hover:bg-muted" onClick={() => onOpenReport(item.id)}>
                <span>版本 {item.version} · {item.createdAt.slice(0, 16).replace('T', ' ')}</span>
                <span className="text-muted-foreground">{item.report?.directions.length ?? 0} 个方向</span>
              </button>
            ))}
          </div>
        </div>
      )}

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <DialogTitle>生成依据</DialogTitle>
            <DialogDescription>生成时会重新核对当前有效感兴趣岗位；已撤销反馈不计入。</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="rounded-md bg-muted p-3 text-sm">感兴趣岗位：<strong>{state.interestedCount}</strong> 个</div>
            <div className="rounded-md border p-3">
              <p className="text-sm font-medium">当前简历</p>
              <p className="mt-1 text-xs text-muted-foreground">个人背景 · 当前版本 {prefs?.updatedAt.slice(0, 16).replace('T', ' ')}</p>
              {!state.resumeAvailable && <p className="mt-2 text-xs text-destructive">当前简历为空，请先在偏好设置中填写。</p>}
            </div>
            <div>
              <div className="mb-2 flex items-center justify-between text-sm">
                <span className="font-medium">素材故事（可选）</span><span className="text-xs text-muted-foreground">已选 {draft?.materialIds.length ?? 0}/3</span>
              </div>
              <div className="relative mb-2">
                <Search className="absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
                <Input className="pl-8" placeholder="搜索素材" value={search} onChange={(event) => setSearch(event.target.value)} />
              </div>
              <div className="max-h-52 space-y-1 overflow-y-auto">
                {materials.length === 0 ? <p className="py-6 text-center text-xs text-muted-foreground">素材库为空，可直接使用当前简历</p> : filteredMaterials.length === 0 ? (
                  <p className="py-6 text-center text-xs text-muted-foreground">没有匹配的素材 <Button variant="link" size="sm" onClick={() => setSearch('')}>清除搜索</Button></p>
                ) : filteredMaterials.map((material) => (
                  <label key={material.id} className="flex min-h-11 cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-xs hover:bg-muted">
                    <input type="checkbox" className="size-4 accent-[#2563eb]" checked={draft?.materialIds.includes(material.id) ?? false} onChange={() => toggleMaterial(material.id)} />
                    <span>{material.project} · {material.title}</span>
                  </label>
                ))}
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>取消</Button>
            <Button variant="outline" onClick={applyBasis} disabled={saving}>应用选择</Button>
            <Button onClick={generate} disabled={saving || disabled || !state.resumeAvailable || state.interestedCount === 0}>
              {current ? '更新并生成' : '生成方向建议'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  )
}
