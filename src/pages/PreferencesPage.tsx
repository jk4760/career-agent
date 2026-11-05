import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Separator } from '@/components/ui/separator'
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
    const savedPrefs = await repo.savePreferences({
      ...prefs,
      industries: parseList(form.industries),
      roles: parseList(form.roles),
      locations: parseList(form.locations),
      salaryMin: Number.isFinite(salaryMin) ? salaryMin : null,
      keywordsInclude: parseList(form.keywordsInclude),
      keywordsExclude: parseList(form.keywordsExclude),
    })
    setPrefs(savedPrefs)
    setSaved(true)
  }

  return (
    <div className="max-w-xl space-y-4">
      <div>
        <h1 className="text-xl font-semibold">偏好设置</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          静态结构化筛选条件，供后续采集匹配使用。多值用逗号分隔。
        </p>
      </div>

      <Separator />

      <div className="space-y-4">
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
        {saved && <span className="text-sm text-emerald-600">已保存</span>}
        <span className="text-xs text-muted-foreground">
          上次更新：{prefs.updatedAt.slice(0, 10)}
        </span>
      </div>
    </div>
  )
}
