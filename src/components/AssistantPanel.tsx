import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ChevronRight, Paperclip, SendHorizontal, Sparkles } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { useRepository } from '@/lib/repository'
import { cn } from '@/lib/utils'

const GOTO_SETTINGS = '__goto_settings__'

/**
 * AI 助手面板（§6.6，全局第三栏）：宽 224px，默认展开，展开 ↔ 收起 200ms 过渡。
 * 收起为 30px 竖条（居中竖排「AI 对话」）。头部 = 标题 + 模型下拉 + 收起图标。
 * v0.5 仅骨架：发送禁用，真实对话属 M5。
 */
export function AssistantPanel() {
  const repo = useRepository()
  const navigate = useNavigate()
  const [collapsed, setCollapsed] = useState(false)
  const [models, setModels] = useState<string[]>([])
  const [selectedModel, setSelectedModel] = useState('')
  const [input, setInput] = useState('')
  const [hint, setHint] = useState<string | null>(null)

  // 模型下拉数据源 = 「AI 对话管理」页配置（6.7）；repo 变化时自动联动
  useEffect(() => {
    void repo.getAISettings().then((s) => setModels(s.models))
  }, [repo])

  useEffect(() => {
    if (models.length === 0) {
      setSelectedModel('')
    } else if (!models.includes(selectedModel)) {
      setSelectedModel(models[0])
    }
  }, [models, selectedModel])

  return (
    <aside
      className={cn(
        'sticky top-0 hidden h-screen shrink-0 flex-col border-l bg-card transition-[width] duration-200 md:flex',
        collapsed ? 'w-[30px]' : 'w-56',
      )}
    >
      {collapsed ? (
        /* 收起态：30px 竖条，居中竖排「AI 对话」，点击展开 */
        <button
          type="button"
          aria-label="展开 AI 助手面板"
          className="flex flex-1 cursor-pointer flex-col items-center justify-center gap-2 text-xs text-muted-foreground outline-none hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50"
          onClick={() => setCollapsed(false)}
        >
          <span>AI</span>
          <span>对</span>
          <span>话</span>
        </button>
      ) : (
        <>
          {/* 头部：标题 + 模型下拉 + 收起图标 */}
          <div className="flex h-14 shrink-0 items-center gap-1.5 border-b px-3">
            <Sparkles className="size-4 shrink-0 text-primary" />
            <span className="shrink-0 text-sm font-medium">AI 助手</span>
            <Select
              value={models.length === 0 ? GOTO_SETTINGS : selectedModel}
              onValueChange={(v) => {
                if (v === GOTO_SETTINGS) {
                  navigate('/ai-settings')
                } else {
                  setSelectedModel(v as string)
                }
              }}
            >
              <SelectTrigger
                size="sm"
                className="min-w-0 flex-1 border-transparent bg-transparent px-1.5 text-xs shadow-none"
              >
                <SelectValue>
                  {(v: string) => (v === GOTO_SETTINGS ? '未配置模型' : v)}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                {models.length === 0 ? (
                  <SelectItem value={GOTO_SETTINGS}>
                    ＋ 前往「AI 对话管理」添加模型
                  </SelectItem>
                ) : (
                  models.map((m) => (
                    <SelectItem key={m} value={m}>
                      {m}
                    </SelectItem>
                  ))
                )}
              </SelectContent>
            </Select>
            <Button
              variant="ghost"
              size="icon-xs"
              aria-label="收起 AI 助手面板"
              onClick={() => setCollapsed(true)}
            >
              <ChevronRight className="size-4" />
            </Button>
          </div>

          {/* 内容区：空状态 + 气泡样式示意（M5 直接复用） */}
          <div className="flex-1 space-y-4 overflow-y-auto p-3">
            <div className="flex flex-col items-center gap-2 py-8 text-center">
              <Sparkles className="size-6 text-muted-foreground" strokeWidth={1.5} />
              <p className="text-sm font-medium">求职 AI 伙伴</p>
              <p className="text-xs text-muted-foreground">总结项目 · 改简历 · 备面试</p>
            </div>
            <div className="space-y-2 border-t pt-3">
              <p className="text-[11px] text-muted-foreground">气泡样式示意</p>
              <div className="flex justify-end">
                <div className="max-w-[85%] rounded-xl border bg-white px-2.5 py-1.5 text-xs">
                  帮我把「搭建指标体系」改成 60 秒口述版。
                </div>
              </div>
              <div className="flex justify-start">
                <div className="max-w-[85%] rounded-xl bg-accent px-2.5 py-1.5 text-xs text-foreground">
                  好的，按「背景一句话 → 动作三步 → 结果数字」压缩…
                </div>
              </div>
            </div>
          </div>

          {/* 底部输入区：输入框与附件按钮可点，发送禁用 */}
          <div className="border-t p-2.5">
            <div className="flex items-end gap-1.5">
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label="添加附件"
                onClick={() => setHint('附件解析能力将于 M5 上线')}
              >
                <Paperclip className="size-4" />
              </Button>
              <Textarea
                className="min-h-8 flex-1 text-xs"
                placeholder="M5 接入后可用…"
                rows={1}
                value={input}
                onChange={(e) => setInput(e.target.value)}
              />
              <Button size="icon-sm" disabled aria-label="发送（M5 上线）">
                <SendHorizontal className="size-3.5" />
              </Button>
            </div>
            <p className="mt-1.5 text-[11px] text-muted-foreground">
              {hint ?? 'AI 对话能力将于 M5 上线'}
            </p>
          </div>
        </>
      )}
    </aside>
  )
}
