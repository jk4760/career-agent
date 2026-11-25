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

/** 反馈小弹窗：不合适必选六选一 reason；感兴趣可选四选；comment 保留 */
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
          placeholder="补充说明（可留空；自定义内容存为备注，原因请选上方标签）"
          value={comment}
          onChange={(e) => {
            const v = e.target.value
            setComment(v)
            // 修复：「不合适」输入自定义说明时自动选中「其他」，确认不再灰
            // （结构化原因仍走六选一枚举；自定义文字保留为 comment）
            if (action === 'pass' && !reason && v.trim()) setReason('其他')
          }}
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
