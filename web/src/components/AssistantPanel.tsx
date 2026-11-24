import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ChevronDown, ChevronRight, Eye, Plus, SendHorizontal, Sparkles, Square, X } from 'lucide-react'
import { ContextSelector } from '@/components/ai/ContextSelector'
import { SaveAIReplyDialog } from '@/components/ai/SaveAIReplyDialog'
import { NewConversationDialog } from '@/components/ai/NewConversationDialog'
import { MarkdownContent } from '@/components/MarkdownContent'
import { Button } from '@/components/ui/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import {
  createAIConversation,
  getAIConversation,
  listAIConversations,
  saveAIContext,
  stopAIChat,
  streamAIChat,
} from '@/lib/aiApi'
import { useRepository } from '@/lib/repository'
import { cn, uuid } from '@/lib/utils'
import type { AIContextSelection, AIConversation, AIMessage, AISettings, AISaveTargetType, Material } from '@/types'

const CURRENT_CONVERSATION_KEY = 'nextcareer.current-conversation.v1'
const EMPTY_SELECTION: AIContextSelection = {
  includePreferences: true,
  resumeId: null,
  materialIds: [],
  jobIds: [],
}

export function AssistantPanel() {
  const repo = useRepository()
  const navigate = useNavigate()
  const [collapsed, setCollapsed] = useState(false)
  const [mobileOpen, setMobileOpen] = useState(false)
  const [settings, setSettings] = useState<AISettings | null>(null)
  const [conversations, setConversations] = useState<AIConversation[]>([])
  const [currentId, setCurrentId] = useState('')
  const [selection, setSelection] = useState<AIContextSelection>(EMPTY_SELECTION)
  const [messages, setMessages] = useState<AIMessage[]>([])
  const [input, setInput] = useState('')
  const [sending, setSending] = useState(false)
  const [assistantId, setAssistantId] = useState('')
  const [saveTarget, setSaveTarget] = useState<{ message: AIMessage; type: AISaveTargetType; sourceQuestion: string } | null>(null)
  const [libraryMaterials, setLibraryMaterials] = useState<Material[]>([])
  const [newConversationOpen, setNewConversationOpen] = useState(false)
  const [contextOpen, setContextOpen] = useState(false)
  const [contextPreview, setContextPreview] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const sendingRef = useRef(false)
  const messageListRef = useRef<HTMLDivElement>(null)

  const openConversation = async (id: string) => {
    const detail = await getAIConversation(id)
    setCurrentId(id)
    setSelection(detail.contextSelection)
    setMessages(detail.messages)
    localStorage.setItem(CURRENT_CONVERSATION_KEY, id)
  }

  const newConversation = async (catalogId?: string) => {
    const created = await createAIConversation(catalogId)
    const conversation = { ...created, title: '新对话' }
    setConversations((current) => [conversation, ...current])
    setCurrentId(created.id)
    setSelection(created.contextSelection)
    setMessages([])
    setNewConversationOpen(false)
    localStorage.setItem(CURRENT_CONVERSATION_KEY, created.id)
  }

  useEffect(() => {
    void (async () => {
      const config = await repo.getAISettings()
      setSettings(config)
      if (!config.enabled || !config.configured) return
      const list = await listAIConversations()
      setConversations(list)
      const stored = localStorage.getItem(CURRENT_CONVERSATION_KEY)
      const target = list.find((item) => item.id === stored) ?? list[0]
      if (target) await openConversation(target.id)
      else await newConversation()
    })().catch((err) => setError(err instanceof Error ? err.message : 'AI 助手加载失败'))
  }, [repo])

  const updateAssistant = (id: string, patch: Partial<AIMessage>) => {
    setMessages((current) => current.map((message) => (message.id === id ? { ...message, ...patch } : message)))
  }

  const send = async () => {
    if (sendingRef.current) {
      if (assistantId) await stopAIChat(assistantId)
      return
    }
    const content = input.trim()
    if (!content || !currentId || !settings?.enabled || !settings.configured || settings.budget.exhausted) return
    sendingRef.current = true
    setSending(true)
    setError(null)
    setInput('')
    const clientRequestId = uuid()
    const userId = `local-user-${clientRequestId}`
    const localAssistantId = `local-assistant-${clientRequestId}`
    setMessages((current) => [
      ...current,
      { id: userId, role: 'user', content, status: 'done', createdAt: new Date().toISOString() },
      { id: localAssistantId, role: 'assistant', content: '', status: 'streaming', createdAt: new Date().toISOString() },
    ])
    let serverAssistantId = localAssistantId
    try {
      const response = await streamAIChat({ conversationId: currentId, content, clientRequestId })
      if (!response.ok) {
        const body = await response.json().catch(() => null)
        throw new Error(body?.error ?? `发送失败（${response.status}）`)
      }
      const contentType = response.headers.get('content-type') ?? ''
      if (contentType.includes('application/json')) {
        const duplicate = await response.json()
        if (duplicate.duplicate) {
          serverAssistantId = duplicate.assistantMessageId
          updateAssistant(localAssistantId, {
            id: serverAssistantId,
            content: duplicate.content,
            status: duplicate.status,
          })
        }
        return
      }
      if (!response.body) throw new Error('当前浏览器不支持流式响应')
      const reader = response.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''
      while (true) {
        const { done, value } = await reader.read()
        buffer += decoder.decode(value, { stream: !done })
        let boundary = buffer.indexOf('\n\n')
        while (boundary >= 0) {
          const packet = buffer.slice(0, boundary)
          buffer = buffer.slice(boundary + 2)
          boundary = buffer.indexOf('\n\n')
          const event = packet.match(/^event:\s*(.+)$/m)?.[1]
          const raw = packet.match(/^data:\s*(.+)$/m)?.[1]
          if (!event || !raw) continue
          const data = JSON.parse(raw)
          if (event === 'meta') {
            serverAssistantId = data.assistantMessageId
            setAssistantId(serverAssistantId)
            updateAssistant(localAssistantId, { id: serverAssistantId })
          } else if (event === 'delta') {
            setMessages((current) =>
              current.map((message) =>
                message.id === serverAssistantId
                  ? { ...message, content: message.content + data.content }
                  : message,
              ),
            )
            const list = messageListRef.current
            if (list && list.scrollHeight - list.scrollTop - list.clientHeight < 120) {
              list.scrollTop = list.scrollHeight
            }
          } else if (event === 'done') {
            updateAssistant(serverAssistantId, { status: data.status })
          } else if (event === 'error') {
            updateAssistant(serverAssistantId, { status: 'error' })
            setError(`生成失败（${data.code}），可手动再次发送`)
          }
        }
        if (done) break
      }
    } catch (err) {
      updateAssistant(serverAssistantId, { status: 'error' })
      setError(err instanceof Error ? err.message : '网络中断，可手动再次发送')
    } finally {
      sendingRef.current = false
      setSending(false)
      setAssistantId('')
      const list = await listAIConversations().catch(() => null)
      if (list) setConversations(list)
    }
  }

  const applyContext = async (next: AIContextSelection) => {
    if (!currentId) return
    const result = await saveAIContext(currentId, next)
    setSelection(next)
    setContextOpen(false)
    setContextPreview(false)
    void result
  }

  const openSave = async (message: AIMessage, type: AISaveTargetType) => {
    const index = messages.findIndex((item) => item.id === message.id)
    const sourceQuestion = messages.slice(0, index).reverse().find((item) => item.role === 'user')?.content ?? ''
    try {
      const materials = await repo.listMaterials()
      setLibraryMaterials(materials)
      setSaveTarget({ message, type, sourceQuestion })
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '素材列表读取失败')
    }
  }

  const canSend = Boolean(
    currentId &&
      settings?.enabled &&
      settings.configured &&
      !settings.budget.exhausted &&
      input.trim(),
  )

  const currentConversation = conversations.find((conversation) => conversation.id === currentId)

  const contextSummary = (
    <div className="border-t px-3 py-2">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium">本次上下文</span>
        <div className="flex items-center gap-1 text-xs">
          <button type="button" className="flex items-center gap-0.5 text-primary" onClick={() => { setContextPreview(true); setContextOpen(true) }}>
            <Eye className="size-3" />查看
          </button>
          <button type="button" className="rounded p-0.5 text-muted-foreground" aria-label="调整上下文" onClick={() => { setContextPreview(false); setContextOpen(true) }}>
            <ChevronDown className="size-3.5" />
          </button>
        </div>
      </div>
      <button
        type="button"
        className="mt-1.5 flex w-full flex-wrap gap-1 text-left"
        onClick={() => { setContextPreview(false); setContextOpen(true) }}
      >
        <span className={cn('rounded px-1.5 py-0.5 text-[10px]', selection.includePreferences ? 'bg-accent text-accent-foreground' : 'bg-muted text-muted-foreground')}>求职偏好</span>
        <span className={cn('rounded px-1.5 py-0.5 text-[10px]', selection.resumeId ? 'bg-accent text-accent-foreground' : 'bg-muted text-muted-foreground')}>当前简历</span>
        <span className={cn('rounded px-1.5 py-0.5 text-[10px]', selection.materialIds.length ? 'bg-accent text-accent-foreground' : 'bg-muted text-muted-foreground')}>素材 {selection.materialIds.length}</span>
      </button>
      <p className="mt-1 text-[10px] text-muted-foreground">仅当前会话生效</p>
    </div>
  )

  const panel = (mobile: boolean) => (
    <>
      <div className="flex h-14 shrink-0 items-center gap-1.5 border-b px-3">
        <Sparkles className="size-4 shrink-0 text-primary" />
        <span className="shrink-0 text-sm font-medium">AI 助手</span>
        <Select value={currentId} onValueChange={(value) => void openConversation(value as string)}>
          <SelectTrigger
            size="sm"
            className="min-w-0 flex-1 border-transparent bg-transparent px-1.5 text-xs shadow-none"
            aria-label={`当前模型 ${currentConversation?.model ?? settings?.model ?? '未配置'}；点击切换会话`}
          >
            <SelectValue>{() => settings?.enabled ? (currentConversation?.model ?? settings.model) : '未配置模型'}</SelectValue>
          </SelectTrigger>
          <SelectContent>
            {conversations.map((conversation) => (
              <SelectItem key={conversation.id} value={conversation.id}>{conversation.title}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button variant="ghost" size="icon-xs" aria-label="新建会话" onClick={() => setNewConversationOpen(true)} disabled={!settings?.enabled || !settings.configured}>
          <Plus />
        </Button>
        <Button variant="ghost" size="icon-xs" aria-label={mobile ? '返回' : '收起 AI 助手面板'} onClick={() => mobile ? setMobileOpen(false) : setCollapsed(true)}>
          {mobile ? <X /> : <ChevronRight />}
        </Button>
      </div>

      <div ref={messageListRef} className="flex-1 space-y-3 overflow-y-auto p-3">
        {!settings?.enabled || !settings.configured ? (
          <div className="flex flex-col items-center gap-2 py-10 text-center">
            <Sparkles className="size-6 text-muted-foreground" />
            <p className="text-sm font-medium">{settings?.enabled ? '未配置模型' : 'AI 对话尚未启用'}</p>
            <p className="text-xs text-muted-foreground">模型与 Key 由服务器管理员配置</p>
          </div>
        ) : messages.length === 0 ? (
          <div className="flex flex-col items-center gap-2 py-10 text-center">
            <Sparkles className="size-6 text-muted-foreground" />
            <p className="text-sm font-medium">求职 AI 伙伴</p>
            <p className="text-xs text-muted-foreground">总结项目 · 改简历 · 备面试</p>
          </div>
        ) : (
          messages.map((message) => (
            <div key={message.id} className={cn('flex flex-col', message.role === 'user' ? 'items-end' : 'items-start')}>
              <div className={cn('max-w-[92%] rounded-lg px-2.5 py-2 text-xs', message.role === 'user' ? 'bg-primary text-primary-foreground' : 'bg-accent')}>
                {message.role === 'assistant' ? <MarkdownContent content={message.content || (message.status === 'streaming' ? '正在思考…' : '（无内容）')} /> : <span className="whitespace-pre-wrap">{message.content}</span>}
              </div>
              {message.role === 'assistant' && message.status !== 'done' && message.status !== 'streaming' && (
                <span className="mt-1 text-[10px] text-muted-foreground">
                  {{ stopped: '已停止', error: '生成失败', truncated: '内容已截断', streaming: '', done: '' }[message.status]}
                </span>
              )}
              {message.role === 'assistant' && message.status === 'done' && message.content.trim() && (
                <div className="mt-1 flex min-h-7 items-center gap-3 text-[11px] text-muted-foreground">
                  <button type="button" className="hover:text-primary" onClick={() => void openSave(message, 'material')}>保存为素材</button>
                  <button type="button" className="hover:text-primary" onClick={() => void openSave(message, 'question')}>保存为问答</button>
                </div>
              )}
            </div>
          ))
        )}
        {error && <p className="text-xs text-destructive">{error}</p>}
      </div>

      {settings && settings.budget.percent >= 80 && (
        <p className="border-t px-3 py-1.5 text-[10px] text-amber-700">
          今日模型估算费用 {settings.budget.totalCny} / {settings.budget.limitCny} 元{settings.budget.exhausted ? '，新发送已暂停' : ''}
        </p>
      )}
      {contextSummary}
      <div className="border-t p-2.5 pb-[max(0.625rem,env(safe-area-inset-bottom))]">
        <div className="flex items-end gap-1.5">
          <Textarea
            className="min-h-9 flex-1 text-xs"
            placeholder={settings?.budget.exhausted ? '今日模型额度已用完' : '输入问题…'}
            rows={1}
            value={input}
            disabled={!settings?.enabled || !settings.configured || settings.budget.exhausted}
            onChange={(event) => setInput(event.target.value)}
            onKeyDown={(event) => {
              if (event.nativeEvent.isComposing) return
              if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault()
                void send()
              }
            }}
          />
          <Button size="icon-sm" disabled={!sending && !canSend} aria-label={sending ? '停止' : '发送'} onClick={() => void send()}>
            {sending ? <Square /> : <SendHorizontal />}
          </Button>
        </div>
      </div>
    </>
  )

  return (
    <>
      <aside className={cn('sticky top-0 hidden h-screen shrink-0 flex-col border-l bg-card transition-[width] duration-200 md:flex', collapsed ? 'w-[30px]' : 'w-96')}>
        {collapsed ? (
          <button type="button" aria-label="展开 AI 助手面板" className="flex flex-1 cursor-pointer flex-col items-center justify-center gap-2 text-xs text-muted-foreground hover:bg-muted" onClick={() => setCollapsed(false)}>
            <span>AI</span><span>对</span><span>话</span>
          </button>
        ) : panel(false)}
      </aside>
      <Button className="fixed right-4 bottom-4 z-30 md:hidden" size="icon" aria-label="打开 AI 助手" onClick={() => setMobileOpen(true)}>
        <Sparkles />
      </Button>
      {mobileOpen && <div className="fixed inset-0 z-50 flex flex-col bg-card md:hidden">{panel(true)}</div>}
      <ContextSelector open={contextOpen} selection={selection} startPreview={contextPreview} onCancel={() => { setContextOpen(false); setContextPreview(false) }} onApply={applyContext} />
      <NewConversationDialog
        open={newConversationOpen}
        catalog={settings?.catalog ?? []}
        onCancel={() => setNewConversationOpen(false)}
        onCreate={newConversation}
      />
      <SaveAIReplyDialog
        message={saveTarget?.message ?? null}
        targetType={saveTarget?.type ?? null}
        sourceQuestion={saveTarget?.sourceQuestion ?? ''}
        materials={libraryMaterials}
        onClose={() => setSaveTarget(null)}
        onView={(result) => {
          setSaveTarget(null)
          setMobileOpen(false)
          navigate(result.targetType === 'material' ? `/materials?focus=${result.targetId}` : `/questions?focus=${result.targetId}`)
        }}
      />
    </>
  )
}
