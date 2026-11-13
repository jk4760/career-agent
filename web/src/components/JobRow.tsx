import { useState } from 'react'
import { ChevronDown, ExternalLink } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { FeedbackDialog, feedbackActionLabels } from '@/components/FeedbackDialog'
import { StatusBadge } from '@/components/StatusBadge'
import { cn } from '@/lib/utils'
import type { FeedbackAction, JobWithStatus } from '@/types'

function formatSalary(job: JobWithStatus): string {
  if (job.salaryMin == null || job.salaryMax == null) return '薪资面议'
  return `${Math.round(job.salaryMin / 1000)}k–${Math.round(job.salaryMax / 1000)}k`
}

/** 元信息 pill：默认白底 1px 边框，accent 用 blue-50 底（§10.6.1） */
function MetaPill({
  children,
  accent,
  className,
}: {
  children: React.ReactNode
  accent?: boolean
  className?: string
}) {
  return (
    <span
      className={cn(
        'rounded-lg px-1.5 py-0.5 text-[11px] whitespace-nowrap',
        accent
          ? 'bg-accent text-accent-foreground'
          : 'border bg-white text-muted-foreground',
        className,
      )}
    >
      {children}
    </span>
  )
}

interface JobRowProps {
  job: JobWithStatus
  onFeedback: (jobId: string, action: FeedbackAction, reason: string | null, comment: string) => void
  /** M4 飞书深链：?focus=<id> 时默认展开详情 */
  defaultExpanded?: boolean
  /** M4 飞书深链：?action=xxx 时自动打开对应反馈弹窗 */
  initialAction?: FeedbackAction | null
}

/**
 * 行式岗位条目（§10.6.1 三段式）：
 * 左 40px 公司首字符方块 | 中：标题 + 公司 | 右：元信息 pill + 状态徽标 + 操作按钮。
 * 行 hover 时 pill 轻微左移（§10.6.7），点击就地展开详情（§10.6.2 动画）。
 */
export function JobRow({ job, onFeedback, defaultExpanded = false, initialAction = null }: JobRowProps) {
  const [expanded, setExpanded] = useState(defaultExpanded)
  const [pendingAction, setPendingAction] = useState<FeedbackAction | null>(initialAction)

  return (
    <div className="group/row">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-3 sm:flex-nowrap">
        {/* 左 + 中：首字符方块、标题与公司（点击展开） */}
        <button
          type="button"
          className="flex min-w-0 flex-1 cursor-pointer items-center gap-3 rounded-md text-left outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
          onClick={() => setExpanded((v) => !v)}
          aria-expanded={expanded}
        >
          <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-[15px] font-semibold text-slate-600">
            {job.company.slice(0, 1)}
          </span>
          <span className="min-w-0">
            <span className="block truncate text-[15px] font-semibold">{job.title}</span>
            <span className="mt-0.5 block truncate text-[13px] text-muted-foreground">
              {job.company}
            </span>
            {/* M4：LLM 理由标签 + 规则事实标签 */}
            {(job.score.llmReasons.length > 0 || job.score.ruleFacts.length > 0) && (
              <span className="mt-1 flex flex-wrap gap-1">
                {job.score.llmReasons.map((t) => (
                  <span
                    key={`llm-${t}`}
                    className="rounded-md bg-accent px-1.5 py-0.5 text-[11px] text-accent-foreground"
                  >
                    {t}
                  </span>
                ))}
                {job.score.ruleFacts.map((t) => (
                  <span
                    key={`fact-${t}`}
                    className="rounded-md border px-1.5 py-0.5 text-[11px] text-muted-foreground"
                  >
                    {t}
                  </span>
                ))}
              </span>
            )}
          </span>
        </button>

        {/* 右：元信息 pill（桌面端展示，hover 左移让出操作区） */}
        <div className="hidden shrink-0 items-center gap-1.5 transition-transform duration-300 group-hover/row:-translate-x-2 lg:flex">
          {/* M4：最终排序分（降级时附说明） */}
          <MetaPill accent className="tabular-nums" aria-label="最终排序分">
            匹配 {job.score.final}
          </MetaPill>
          {job.location && <MetaPill>{job.location}</MetaPill>}
          <MetaPill className="tabular-nums">{formatSalary(job)}</MetaPill>
          <MetaPill accent>{job.source}</MetaPill>
          <span className="text-[11px] whitespace-nowrap text-foreground/50 tabular-nums">
            {job.collectedAt.slice(0, 10)}
          </span>
        </div>

        <div className="flex shrink-0 items-center gap-1.5">
          <StatusBadge status={job.status} />
          <span className="mx-1 h-4 w-px bg-border max-sm:hidden" />
          <Button size="sm" variant="outline" onClick={() => setPendingAction('interested')}>
            感兴趣
          </Button>
          <Button size="sm" variant="outline" onClick={() => setPendingAction('pass')}>
            不合适
          </Button>
          <Button size="sm" variant="outline" onClick={() => setPendingAction('applied')}>
            已投递
          </Button>
          <Button
            size="icon-sm"
            variant="ghost"
            aria-label={expanded ? '收起详情' : '展开详情'}
            onClick={() => setExpanded((v) => !v)}
          >
            <ChevronDown
              className={`size-4 text-muted-foreground transition-transform ${expanded ? 'rotate-180' : ''}`}
            />
          </Button>
        </div>
      </div>

      {expanded && (
        <div className="border-t-[0.5px] bg-muted/40 px-4 py-3">
          <div className="row-expand">
            {job.score.llmHighlight && (
              <p className="mb-2 max-w-3xl text-[13px] text-muted-foreground">
                看点：{job.score.llmHighlight}
              </p>
            )}
            <p className="max-w-3xl text-[15px] leading-relaxed whitespace-pre-wrap text-foreground/90">
              {job.description ?? '（无描述）'}
            </p>

            {job.feedbackEvents.length > 0 && (
              <div className="mt-3 max-w-3xl rounded-md border bg-card p-2.5 text-xs text-muted-foreground">
                {job.feedbackEvents.map((e) => (
                  <div key={e.id}>
                    <span className="tabular-nums">{e.createdAt.slice(0, 10)}</span> 标记为「
                    {feedbackActionLabels[e.action]}」{e.reason ? `（${e.reason}）` : ''}
                    {e.comment ? `：${e.comment}` : ''}
                  </div>
                ))}
              </div>
            )}

            {/* M4：分数可解释（规则分 / LLM 分 / 反馈调整拆开） */}
            <div className="mt-2 max-w-3xl text-xs text-muted-foreground tabular-nums">
              最终分 {job.score.final} ={' '}
              {job.score.usedFallback ? `规则分 ${job.score.rule}（LLM 未评分）` : `LLM 分 ${job.score.llm}`}
              {job.score.feedback.total !== 0 &&
                ` ${job.score.feedback.total > 0 ? '+' : ''}${job.score.feedback.total} 反馈调整`}
            </div>

            <div className="mt-3">
              <Button
                variant="outline"
                size="sm"
                render={<a href={job.sourceUrl} target="_blank" rel="noreferrer" />}
              >
                <ExternalLink className="size-3.5" />
                投递链接
              </Button>
            </div>
          </div>
        </div>
      )}

      {pendingAction && (
        <FeedbackDialog
          open
          action={pendingAction}
          jobTitle={`${job.company} · ${job.title}`}
          onOpenChange={(open) => {
            if (!open) setPendingAction(null)
          }}
          onConfirm={(reason, comment) => {
            onFeedback(job.id, pendingAction, reason, comment)
            setPendingAction(null)
          }}
        />
      )}
    </div>
  )
}
