import { Badge } from '@/components/ui/badge'
import type { JobStatus } from '@/types'

const statusConfig: Record<JobStatus, { label: string; className: string }> = {
  new: { label: '新岗位', className: 'border-slate-200 bg-slate-100 text-slate-700' },
  interested: {
    label: '感兴趣',
    className: 'border-emerald-200 bg-emerald-100 text-emerald-700',
  },
  pass: { label: '不合适', className: 'border-red-200 bg-red-100 text-red-600' },
  applied: { label: '已投递', className: 'border-blue-200 bg-blue-100 text-blue-700' },
}

export function StatusBadge({ status }: { status: JobStatus }) {
  const { label, className } = statusConfig[status]
  return (
    <Badge variant="outline" className={className}>
      {label}
    </Badge>
  )
}
