import { Badge } from '@/components/ui/badge'
import type { JobStatus } from '@/types'

const statusConfig: Record<JobStatus, { label: string; className: string }> = {
  new: { label: '新岗位', className: 'border-status-new/30 bg-status-new/10 text-status-new' },
  interested: {
    label: '感兴趣',
    className: 'border-status-interested/30 bg-status-interested/10 text-status-interested',
  },
  pass: { label: '不合适', className: 'border-status-pass/40 bg-status-pass/10 text-status-pass' },
  applied: {
    label: '已投递',
    className: 'border-status-applied/30 bg-status-applied/10 text-status-applied',
  },
}

export function StatusBadge({ status }: { status: JobStatus }) {
  const { label, className } = statusConfig[status]
  return (
    <Badge variant="outline" className={className}>
      {label}
    </Badge>
  )
}
