import { useState } from 'react'
import { Paperclip, Plus, SendHorizontal, Sparkles } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'

/**
 * AI 助手（§6.6 / §10.11，v0.5 仅 UI 骨架）：
 * 左窄栏会话列表 + 右侧对话区。真实对话、记忆、附件解析属 M5，
 * 本批次不做任何 mock 对话逻辑（发送禁用 + 提示文案）。
 */
export default function AssistantPage() {
  const [input, setInput] = useState('')
  const [hint, setHint] = useState<string | null>(null)

  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-[240px_1fr]">
      {/* 左窄栏：会话列表 */}
      <div className="space-y-2">
        <Button className="w-full">
          <Plus className="size-4" />
          新会话
        </Button>
        <p className="px-1 pt-2 text-xs text-muted-foreground">暂无历史会话</p>
      </div>

      {/* 右侧对话区 */}
      <div className="flex min-h-[480px] min-w-0 flex-col rounded-lg border bg-card">
        {/* 消息流：空状态 + 气泡样式示意（M5 直接复用） */}
        <div className="flex-1 space-y-4 p-4 sm:p-6">
          <div className="flex flex-col items-center gap-2 py-10 text-center">
            <Sparkles className="size-6 text-muted-foreground" strokeWidth={1.5} />
            <p className="text-sm font-medium">AI 助手</p>
            <p className="max-w-sm text-sm text-muted-foreground">
              M5 上线后，它可以基于你的素材库与偏好：总结项目、改简历、备面试。
            </p>
          </div>

          {/* 气泡样式示意（定稿用，非真实对话） */}
          <div className="space-y-3 border-t pt-4">
            <p className="text-xs text-muted-foreground">气泡样式示意</p>
            <div className="flex justify-end">
              <div className="max-w-[75%] rounded-xl border bg-white px-3 py-2 text-sm">
                帮我把「搭建指标体系」这个故事改成 60 秒口述版。
              </div>
            </div>
            <div className="flex justify-start">
              <div className="max-w-[75%] rounded-xl bg-accent px-3 py-2 text-sm text-foreground">
                好的，我会按「背景一句话 → 动作三步 → 结果数字」的结构压缩到 60 秒以内…
              </div>
            </div>
          </div>
        </div>

        {/* 底部输入区：输入框与附件按钮可点，发送禁用 */}
        <div className="border-t p-3">
          <div className="flex items-end gap-2">
            <Button
              variant="outline"
              size="icon"
              aria-label="添加附件"
              onClick={() => setHint('附件解析能力将于 M5 上线')}
            >
              <Paperclip className="size-4" />
            </Button>
            <Textarea
              className="min-h-10 flex-1"
              placeholder="输入消息…"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              rows={1}
            />
            <Button size="icon" disabled aria-label="发送（M5 上线）">
              <SendHorizontal className="size-4" />
            </Button>
          </div>
          <p className="mt-1.5 text-xs text-muted-foreground">
            {hint ?? 'AI 对话能力将于 M5 上线'}
          </p>
        </div>
      </div>
    </div>
  )
}
