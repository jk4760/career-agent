import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { useRepository } from '@/lib/repository'
import type { Preferences } from '@/types'

function parseList(input: string): string[] {
  return input
    .split(/[,，]/)
    .map((t) => t.trim())
    .filter(Boolean)
}

interface FormState {
  industries: string
  roles: string
  locations: string
  salaryMin: string
  keywordsInclude: string
  keywordsExclude: string
  experienceMin: string
  backgroundText: string
}

const FIELD_META: { key: keyof Omit<FormState, 'backgroundText'>; label: string; placeholder: string; type?: string }[] = [
  { key: 'industries', label: '目标行业', placeholder: '如：互联网, 人工智能' },
  { key: 'roles', label: '目标职能', placeholder: '如：产品经理, 数据分析师' },
  { key: 'locations', label: '目标城市', placeholder: '如：上海, 远程' },
  { key: 'salaryMin', label: '薪资底线（元/月）', placeholder: '如：25000', type: 'number' },
  { key: 'keywordsInclude', label: '包含关键词', placeholder: '命中任一关键词的岗位优先，如：AI, 大模型' },
  { key: 'keywordsExclude', label: '排除关键词', placeholder: '命中任一关键词的岗位过滤，如：销售, 外包' },
  { key: 'experienceMin', label: '经验要求上限（年，可空）', placeholder: '如：6；留空表示不限', type: 'number' },
]

export default function PreferencesPage() {
  const repo = useRepository()
  const [prefs, setPrefs] = useState<Preferences | null>(null)
  const [form, setForm] = useState<FormState | null>(null)
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    void repo.getPreferences().then((p) => {
      setPrefs(p)
      setForm({
        industries: p.industries.join(', '),
        roles: p.roles.join(', '),
        locations: p.locations.join(', '),
        salaryMin: p.salaryMin?.toString() ?? '',
        keywordsInclude: p.keywordsInclude.join(', '),
        keywordsExclude: p.keywordsExclude.join(', '),
        experienceMin: p.experienceMin?.toString() ?? '',
        backgroundText: p.backgroundText ?? '',
      })
    })
  }, [repo])

  if (!prefs || !form) {
    return <p className="text-sm text-muted-foreground">加载中…</p>
  }

  const update = (key: keyof FormState) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    setForm({ ...form, [key]: e.target.value })
    setSaved(false)
  }

  const handleSave = async () => {
    const salaryMin = form.salaryMin.trim() === '' ? null : Number(form.salaryMin)
    const experienceMin = form.experienceMin.trim() === '' ? null : Number(form.experienceMin)
    const savedPrefs = await repo.savePreferences({
      ...prefs,
      industries: parseList(form.industries),
      roles: parseList(form.roles),
      locations: parseList(form.locations),
      salaryMin: Number.isFinite(salaryMin) ? salaryMin : null,
      keywordsInclude: parseList(form.keywordsInclude),
      keywordsExclude: parseList(form.keywordsExclude),
      experienceMin: Number.isFinite(experienceMin) ? experienceMin : null,
      backgroundText: form.backgroundText.trim() ? form.backgroundText.trim() : null,
    })
    setPrefs(savedPrefs)
    setSaved(true)
  }

  const bgLen = form.backgroundText.trim().length

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        静态结构化筛选条件，供采集匹配与 LLM 评分使用。多值用逗号分隔。
      </p>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-5">
        {/* 左：筛选条件（3/5，两列网格排字段） */}
        <div className="rounded-lg border bg-card p-5 lg:col-span-3">
          <h3 className="mb-4 text-sm font-semibold">筛选条件</h3>
          <div className="grid grid-cols-1 gap-x-5 gap-y-4 sm:grid-cols-2">
            {FIELD_META.map((f) => (
              <div key={f.key} className="space-y-1.5">
                <Label htmlFor={`p-${f.key}`}>{f.label}</Label>
                <Input
                  id={`p-${f.key}`}
                  type={f.type ?? 'text'}
                  min={f.type === 'number' ? 0 : undefined}
                  placeholder={f.placeholder}
                  value={form[f.key]}
                  onChange={update(f.key)}
                />
              </div>
            ))}
          </div>
          <p className="mt-4 rounded-lg bg-muted px-3 py-2 text-xs leading-relaxed text-muted-foreground">
            这些条件在采集入库前做硬过滤（宁可漏不可噪）：职能方向 · 城市/远程 · 薪资下限 · 经验上限 · 发布超 120 天。
          </p>
        </div>

        {/* 右：个人背景（2/5，整列高度） */}
        <div className="flex flex-col rounded-lg border bg-card p-5 lg:col-span-2">
          <div className="mb-1 flex items-baseline justify-between">
            <h3 className="text-sm font-semibold">个人背景</h3>
            <span
              className={`text-xs tabular-nums ${
                bgLen >= 300 && bgLen <= 500 ? 'text-status-interested' : 'text-muted-foreground'
              }`}
            >
              {bgLen} / 建议 300–500 字
            </span>
          </div>
          <p className="mb-2 text-xs text-muted-foreground">
            作为 LLM 匹配评分的画像输入；保存后按新背景重评近 60 天岗位。
          </p>
          <Textarea
            className="min-h-[320px] flex-1 text-sm leading-relaxed"
            placeholder="教育背景、核心经历与量化成果、求职方向与偏好。"
            value={form.backgroundText}
            onChange={update('backgroundText')}
          />
        </div>
      </div>

      {/* 底部通宽操作条 */}
      <div className="flex items-center gap-3 rounded-lg border bg-card px-5 py-3">
        <Button onClick={handleSave}>保存</Button>
        {saved && <span className="text-sm font-medium text-status-interested">已保存</span>}
        <span className="ml-auto text-xs tabular-nums text-muted-foreground">
          上次更新：{prefs.updatedAt.slice(0, 10)}
        </span>
      </div>
    </div>
  )
}
