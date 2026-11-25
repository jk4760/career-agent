import { useEffect, useState } from 'react'
import { ChevronRight, Clock, MessagesSquare } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import { MarkdownContent } from '@/components/MarkdownContent'
import { getAIConversation, listAIConversations } from '@/lib/aiApi'
import { cn } from '@/lib/utils'
import type { AIConversation, AIMessage } from '@/types'

type ConversationDetail = AIConversation & { messages: AIMessage[] }

function formatTime(value: string) {
  return value.slice(0, 16).replace('T', ' ')
}

export default function AISettingsPage() {
  const [conversations, setConversations] = useState<AIConversation[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [selected, setSelected] = useState<ConversationDetail | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)

  useEffect(() => {
    void listAIConversations()
      .then(setConversations)
      .catch((cause) => setError(cause instanceof Error ? cause.message : '历史会话读取失败'))
      .finally(() => setLoading(false))
  }, [])

  const openDetail = async (id: string) => {
    setDetailLoading(true)
    setError(null)
    try {
      setSelected(await getAIConversation(id))
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '会话详情读取失败')
    } finally {
      setDetailLoading(false)
    }
  }

  const continueConversation = () => {
    if (!selected) return
    window.dispatchEvent(new CustomEvent('nextcareer:continue-conversation', { detail: selected.id }))
    setSelected(null)
  }

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-[22px] font-semibold tracking-[-0.02em]">历史对话</h2>
        <p className="mt-1 text-sm text-muted-foreground">按最近活跃时间排序。打开只读详情，或从原模型继续对话。</p>
      </div>
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      {loading ? (
        <p className="text-sm text-muted-foreground">加载中…</p>
      ) : conversations.length === 0 ? (
        <div className="rounded-lg border border-dashed p-8 text-center">
          <MessagesSquare className="mx-auto size-6 text-muted-foreground" />
          <p className="mt-3 text-sm font-medium">还没有历史会话</p>
          <p className="mt-1 text-xs text-muted-foreground">在右侧 AI 助手新建会话后，会显示在这里。</p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-lg border bg-card [&>*+*]:border-t [&>*+*]:border-border">
          {conversations.map((conversation) => (
            <button
              key={conversation.id}
              type="button"
              className="flex w-full cursor-pointer items-center gap-3 px-4 py-3.5 text-left hover:bg-muted/60 focus-visible:ring-3 focus-visible:ring-inset focus-visible:ring-ring/50"
              onClick={() => void openDetail(conversation.id)}
            >
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[15px] font-medium">{conversation.title}</span>
                <span className="mt-1 block truncate text-xs text-muted-foreground">{conversation.lastMessage || '暂无消息'}</span>
                <span className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
                  <span>{conversation.provider} / {conversation.model}</span>
                  <span>{conversation.messageCount ?? 0} 条消息</span>
                  <span className="inline-flex items-center gap-1"><Clock className="size-3" />{formatTime(conversation.updatedAt)}</span>
                </span>
              </span>
              <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
            </button>
          ))}
        </div>
      )}

      <Sheet open={selected !== null} onOpenChange={(open) => { if (!open) setSelected(null) }}>
        <SheetContent>
          {detailLoading || !selected ? (
            <p className="p-6 text-sm text-muted-foreground">加载会话…</p>
          ) : (
            <>
              <SheetHeader>
                <SheetTitle>{selected.title}</SheetTitle>
                <SheetDescription>固定模型：{selected.provider} / {selected.model}</SheetDescription>
              </SheetHeader>
              <div className="grid grid-cols-2 gap-3 border-b px-6 py-3 text-xs text-muted-foreground">
                <div>
                  <p>创建时间</p>
                  <p className="mt-1 text-foreground">{formatTime(selected.createdAt)}</p>
                </div>
                <div>
                  <p>最近活跃</p>
                  <p className="mt-1 text-foreground">{formatTime(selected.updatedAt)}</p>
                </div>
              </div>
              <div className="flex-1 space-y-3 overflow-y-auto px-6 py-4">
                {selected.messages.length === 0 ? (
                  <p className="text-sm text-muted-foreground">这个会话还没有消息。</p>
                ) : selected.messages.map((message) => (
                  <div key={message.id} className={cn('flex flex-col', message.role === 'user' ? 'items-end' : 'items-start')}>
                    <div className={cn('max-w-[92%] rounded-lg px-3 py-2 text-sm', message.role === 'user' ? 'bg-primary text-primary-foreground' : 'bg-accent')}>
                      {message.role === 'assistant' ? <MarkdownContent content={message.content || '（无内容）'} /> : <span className="whitespace-pre-wrap">{message.content}</span>}
                    </div>
                    <span className="mt-1 text-[10px] text-muted-foreground">
                      {message.role === 'assistant' ? message.status : '用户'} · {formatTime(message.createdAt)}
                    </span>
                  </div>
                ))}
              </div>
              <SheetFooter>
                <Button onClick={continueConversation}>继续对话</Button>
              </SheetFooter>
            </>
          )}
        </SheetContent>
      </Sheet>
    </div>
  )
}
