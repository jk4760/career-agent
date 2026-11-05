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
import type { FeedbackAction } from '@/types'

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
  onConfirm: (comment: string) => void
}

/** 反馈小弹窗：确认动作 + 可选的一句话 comment */
export function FeedbackDialog({
  open,
  action,
  jobTitle,
  onOpenChange,
  onConfirm,
}: FeedbackDialogProps) {
  const [comment, setComment] = useState('')

  useEffect(() => {
    if (open) setComment('')
  }, [open])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>标记为「{feedbackActionLabels[action]}」</DialogTitle>
          <DialogDescription>{jobTitle}</DialogDescription>
        </DialogHeader>
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
          <Button onClick={() => onConfirm(comment)}>确认</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
