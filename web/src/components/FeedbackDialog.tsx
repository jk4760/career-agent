import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Textarea } from '@/components/ui/textarea'
import { cn } from '@/lib/utils'
import { INTERESTED_REASONS, PASS_REASONS, type FeedbackAction } from '@/types'

export const feedbackActionLabels: Record<FeedbackAction, string> = {
  interested: '感兴趣',
  pass: '不合适',
  applied: '已投递',
}

interface FeedbackDialogProps {
  open: boolean
  action: FeedbackAction
  jobTitle: string
  onOpenChange: (open: boolean) => void
  onConfirm: (reason: string | null, comment: string) => void
}

/** 反馈小弹窗：不合适必选六选一 reason；感兴趣可选三选；comment 保留 */
export function FeedbackDialog({
  open,
  action,
  jobTitle,
  onOpenChange,
  onConfirm,
}: FeedbackDialogProps) {
  const [reason, setReason] = useState<string | null>(null)
  const [comment, setComment] = useState('')

  useEffect(() => {
    if (open) {
      setReason(null)
      setComment('')
    }
  }, [open])

  const options =
    action === 'pass' ? PASS_REASONS : action === 'interested' ? INTERESTED_REASONS : null
  const reasonRequired = action === 'pass'

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>标记为「{feedbackActionLabels[action]}」</DialogTitle>
          <DialogDescription>{jobTitle}</DialogDescription>
        </DialogHeader>

        {options && (
          <div className="space-y-1.5">
            <p className="text-sm text-muted-foreground">
              {reasonRequired ? '主要原因（必选）' : '主要原因（可选）'}
            </p>
            <div className="flex flex-wrap gap-1.5">
              {options.map((r) => (
                <button
                  key={r}
                  type="button"
                  onClick={() => setReason(reason === r ? null : r)}
                  className={cn(
                    'rounded-lg border px-2.5 py-1 text-[13px] transition-colors',
                    reason === r
                      ? 'border-primary bg-accent text-accent-foreground'
                      : 'bg-white text-muted-foreground hover:bg-muted',
                  )}
                >
                  {r}
                </button>
              ))}
            </div>
          </div>
        )}

        <Textarea
          placeholder="附一句话反馈（可留空），如：太偏运营了"
          value={comment}
          onChange={(e) => setComment(e.target.value)}
          rows={3}
        />
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            取消
          </Button>
          <Button disabled={reasonRequired && !reason} onClick={() => onConfirm(reason, comment)}>
            确认
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
