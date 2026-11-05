import { useState } from 'react'
import { ChevronDown, ChevronUp, ExternalLink } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Separator } from '@/components/ui/separator'
import { FeedbackDialog, feedbackActionLabels } from '@/components/FeedbackDialog'
import { StatusBadge } from '@/components/StatusBadge'
import type { FeedbackAction, JobWithStatus } from '@/types'

function formatSalary(job: JobWithStatus): string {
  if (job.salaryMin == null || job.salaryMax == null) return '薪资面议'
  return `${Math.round(job.salaryMin / 1000)}k–${Math.round(job.salaryMax / 1000)}k`
}

interface JobCardProps {
  job: JobWithStatus
  onFeedback: (jobId: string, action: FeedbackAction, comment: string) => void
}

export function JobCard({ job, onFeedback }: JobCardProps) {
  const [expanded, setExpanded] = useState(false)
  const [pendingAction, setPendingAction] = useState<FeedbackAction | null>(null)

  return (
    <Card>
      <CardContent className="p-4">
        <button
          type="button"
          className="flex w-full cursor-pointer items-start justify-between gap-3 text-left"
          onClick={() => setExpanded((v) => !v)}
        >
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-medium">{job.title}</span>
              <StatusBadge status={job.status} />
            </div>
            <div className="mt-1 text-sm text-muted-foreground">
              {job.company}
              {job.location ? ` · ${job.location}` : ''} · {formatSalary(job)} · 来源 {job.source}
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-2 text-sm text-muted-foreground">
            <span>采集于 {job.collectedAt.slice(0, 10)}</span>
            {expanded ? <ChevronUp className="size-4" /> : <ChevronDown className="size-4" />}
          </div>
        </button>

        {expanded && (
          <div className="mt-3">
            <Separator />
            <p className="mt-3 text-sm leading-6 whitespace-pre-wrap text-foreground/90">
              {job.description ?? '（无描述）'}
            </p>

            {job.feedbackEvents.length > 0 && (
              <div className="mt-3 rounded-md bg-muted/50 p-2 text-xs text-muted-foreground">
                {job.feedbackEvents.map((e) => (
                  <div key={e.id}>
                    {e.createdAt.slice(0, 10)} 标记为「{feedbackActionLabels[e.action]}」
                    {e.comment ? `：${e.comment}` : ''}
                  </div>
                ))}
              </div>
            )}

            <div className="mt-3 flex flex-wrap items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                render={<a href={job.sourceUrl} target="_blank" rel="noreferrer" />}
              >
                <ExternalLink className="size-3.5" />
                投递链接
              </Button>
              <div className="flex-1" />
              <Button size="sm" onClick={() => setPendingAction('interested')}>
                感兴趣
              </Button>
              <Button size="sm" variant="destructive" onClick={() => setPendingAction('pass')}>
                不合适
              </Button>
              <Button size="sm" variant="secondary" onClick={() => setPendingAction('applied')}>
                已投递
              </Button>
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
            onConfirm={(comment) => {
              onFeedback(job.id, pendingAction, comment)
              setPendingAction(null)
            }}
          />
        )}
      </CardContent>
    </Card>
  )
}
