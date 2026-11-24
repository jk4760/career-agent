import type { AISourceMetadata } from '@/types'

export function AISourceNote({ source }: { source?: AISourceMetadata | null }) {
  if (!source) return null
  return (
    <p
      className="mt-3 text-xs leading-relaxed text-muted-foreground"
      title={`来源会话 ${source.conversationId} · 来源消息 ${source.messageId}`}
    >
      由 AI 回复保存 · {source.provider} / {source.model} · {source.savedAt.slice(0, 16).replace('T', ' ')}
    </p>
  )
}
