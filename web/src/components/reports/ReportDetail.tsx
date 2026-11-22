import { useEffect, useState } from 'react'
import { ArrowLeft, FileText } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  getReportHistory,
  getReportSnapshots,
  type ReportRow,
  type ReportSnapshot,
} from '@/lib/reportApi'

interface Props {
  reportId: string
  onBack: () => void
  onAdjust: () => void
}

export function ReportDetail({ reportId, onBack, onAdjust }: Props) {
  const [report, setReport] = useState<ReportRow | null>(null)
  const [historical, setHistorical] = useState(false)
  const [snapshot, setSnapshot] = useState<ReportSnapshot | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    void getReportHistory().then((history) => {
      const selected = history.find((item) => item.id === reportId)
      if (!selected) throw new Error('报告不存在')
      setReport(selected)
      setHistorical(selected.id !== history.find((item) => item.status === 'done')?.id)
    }).catch((err) => setError(err instanceof Error ? err.message : '报告读取失败'))
  }, [reportId])

  const openSnapshot = async (sourceId: string) => {
    const result = await getReportSnapshots(reportId)
    const selected = result.snapshots.find((item) => item.sourceId === sourceId)
    if (selected) setSnapshot(selected)
  }

  if (error) return <p className="text-sm text-destructive">{error}</p>
  if (!report) return <p className="text-sm text-muted-foreground">加载报告…</p>
  const content = report.report
  if (!content) return <p className="text-sm text-muted-foreground">该版本没有完整报告内容。</p>

  return (
    <div>
      <div className="mb-5 flex flex-wrap items-center gap-2">
        <Button variant="ghost" size="sm" onClick={onBack}><ArrowLeft />返回感兴趣岗位</Button>
        <Button variant="outline" size="sm" onClick={onAdjust}>调整依据</Button>
        <Button variant="outline" size="sm" onClick={onAdjust}>重新生成</Button>
      </div>
      <div className="flex items-center gap-2">
        <FileText className="size-5 text-primary" />
        <h2 className="text-xl font-semibold">简历方向建议</h2>
        <span className="rounded bg-muted px-2 py-0.5 text-xs text-muted-foreground">{historical ? '历史版本' : '已生成'}</span>
      </div>
      <p className="mt-2 text-xs text-muted-foreground">
        版本 {report.version} · {content.source_summary.interested_job_count} 个岗位 · {content.source_summary.resume_name} · {content.source_summary.material_count} 个素材 · {report.completedAt?.slice(0, 16).replace('T', ' ')}
      </p>
      <h1 className="mt-6 text-2xl font-semibold tracking-[-0.02em]">建议准备 {content.resume_count} 份方向性简历</h1>
      <p className="mt-3 max-w-3xl text-sm leading-relaxed text-slate-600">{content.overview}</p>
      {content.sample_warning && <p className="mt-3 rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-800">{content.sample_warning}</p>}

      <div className="mt-6 grid gap-4 lg:grid-cols-2">
        {content.directions.map((direction, index) => (
          <section key={`${direction.name}-${index}`} className="min-w-0 rounded-lg border bg-card p-5">
            <div className="flex items-start gap-3">
              <span className="shrink-0 text-sm font-semibold text-primary tabular-nums">{String(index + 1).padStart(2, '0')}</span>
              <div className="min-w-0">
                <h3 className="text-base font-semibold break-words">{direction.name}</h3>
                <p className="mt-1 text-sm leading-relaxed text-muted-foreground">{direction.summary}</p>
              </div>
            </div>
            <h4 className="mt-5 text-xs font-semibold">重点能力</h4>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {(direction.key_capabilities ?? []).map((capability) => <span key={capability} className="rounded bg-accent px-2 py-1 text-xs text-accent-foreground break-words">{capability}</span>)}
            </div>
            <h4 className="mt-5 text-xs font-semibold">建议前置经历</h4>
            <div className="mt-2 space-y-2">
              {(direction.priority_experiences ?? []).length === 0 ? <p className="text-xs text-muted-foreground">暂无指定经历</p> : direction.priority_experiences.map((experience, index) => (
                <button key={`${experience.source_id}-${index}`} type="button" className="block w-full rounded-md bg-muted p-2.5 text-left hover:bg-accent" onClick={() => void openSnapshot(experience.source_id)}>
                  <span className="block text-xs font-medium break-words">{experience.title}</span>
                  <span className="mt-1 block text-xs leading-relaxed text-muted-foreground">{experience.reason}</span>
                </button>
              ))}
            </div>
            <h4 className="mt-5 text-xs font-semibold">可用证据</h4>
            <div className="mt-2 space-y-2">
              {(direction.evidence ?? []).length === 0 ? <p className="text-xs text-muted-foreground">暂无逐字证据</p> : direction.evidence.map((evidence, index) => (
                <button key={`${evidence.source_id}-${index}`} type="button" className="block w-full rounded-md border p-2.5 text-left hover:bg-muted" onClick={() => void openSnapshot(evidence.source_id)}>
                  <span className="text-[10px] text-muted-foreground">{evidence.source_type === 'resume' ? '简历' : '素材'} · 生成时的来源</span>
                  <span className="mt-1 block text-xs leading-relaxed break-words">{evidence.text}</span>
                </button>
              ))}
            </div>
            <h4 className="mt-5 text-xs font-semibold">建议补充</h4>
            {(direction.gaps ?? []).length ? (
              <ul className="mt-2 list-disc pl-4 text-xs leading-relaxed text-muted-foreground">{direction.gaps.map((gap) => <li key={gap}>{gap}</li>)}</ul>
            ) : <p className="mt-2 text-xs text-muted-foreground">暂无</p>}
          </section>
        ))}
      </div>
      <p className="mt-6 border-t pt-4 text-xs text-muted-foreground">用于规划方向性简历，正式简历由你确认和编辑。</p>

      <Dialog open={snapshot !== null} onOpenChange={(open) => { if (!open) setSnapshot(null) }}>
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <DialogTitle>生成时的来源</DialogTitle>
            <DialogDescription>历史原文快照 · 版本 {snapshot?.version} · 不受后续编辑影响</DialogDescription>
          </DialogHeader>
          <p className="max-h-[55vh] overflow-y-auto whitespace-pre-wrap rounded-md bg-muted p-4 text-sm leading-relaxed break-words">{snapshot?.content}</p>
        </DialogContent>
      </Dialog>
    </div>
  )
}
