import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
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
}

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
      })
    })
  }, [repo])

  if (!prefs || !form) {
    return <p className="text-sm text-muted-foreground">加载中…</p>
  }

  const update = (key: keyof FormState) => (e: React.ChangeEvent<HTMLInputElement>) => {
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
    })
    setPrefs(savedPrefs)
    setSaved(true)
  }

  return (
    <div className="max-w-xl space-y-4">
      <p className="text-sm text-muted-foreground">
        静态结构化筛选条件，供后续采集匹配使用。多值用逗号分隔。
      </p>

      <div className="space-y-4 rounded-lg border bg-card p-4 sm:p-6">
        <div className="space-y-1.5">
          <Label htmlFor="p-industries">目标行业</Label>
          <Input
            id="p-industries"
            placeholder="如：互联网, 人工智能"
            value={form.industries}
            onChange={update('industries')}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="p-roles">目标职能</Label>
          <Input
            id="p-roles"
            placeholder="如：产品经理, 数据分析师"
            value={form.roles}
            onChange={update('roles')}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="p-locations">目标城市</Label>
          <Input
            id="p-locations"
            placeholder="如：上海, 远程"
            value={form.locations}
            onChange={update('locations')}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="p-salary">薪资底线（元/月）</Label>
          <Input
            id="p-salary"
            type="number"
            min={0}
            placeholder="如：25000"
            value={form.salaryMin}
            onChange={update('salaryMin')}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="p-include">包含关键词</Label>
          <Input
            id="p-include"
            placeholder="命中任一关键词的岗位优先，如：AI, 大模型"
            value={form.keywordsInclude}
            onChange={update('keywordsInclude')}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="p-experience">经验要求上限（年，可空）</Label>
          <Input
            id="p-experience"
            type="number"
            min={0}
            placeholder="如：6；留空表示不限"
            value={form.experienceMin}
            onChange={update('experienceMin')}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="p-exclude">排除关键词</Label>
          <Input
            id="p-exclude"
            placeholder="命中任一关键词的岗位过滤，如：销售, 外包"
            value={form.keywordsExclude}
            onChange={update('keywordsExclude')}
          />
        </div>
      </div>

      <div className="flex items-center gap-3">
        <Button onClick={handleSave}>保存</Button>
        {saved && <span className="text-sm font-medium text-status-interested">已保存</span>}
        <span className="text-xs text-muted-foreground tabular-nums">
          上次更新：{prefs.updatedAt.slice(0, 10)}
        </span>
      </div>
    </div>
  )
}
