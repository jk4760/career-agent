import type { LucideIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'

interface EmptyStateProps {
  icon: LucideIcon
  title: string
  description?: string
  actionLabel?: string
  onAction?: () => void
}

/** 列表空状态：图标 + 引导文案 + 主操作按钮 */
export function EmptyState({ icon: Icon, title, description, actionLabel, onAction }: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed bg-card px-6 py-16 text-center">
      <Icon className="size-6 text-muted-foreground" strokeWidth={1.5} />
      <p className="text-sm font-medium">{title}</p>
      {description && <p className="max-w-sm text-sm text-muted-foreground">{description}</p>}
      {actionLabel && onAction && (
        <Button className="mt-2" onClick={onAction}>
          {actionLabel}
        </Button>
      )}
    </div>
  )
}
