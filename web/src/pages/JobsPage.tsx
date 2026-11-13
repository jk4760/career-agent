import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Inbox } from 'lucide-react'
import { EmptyState } from '@/components/EmptyState'
import { JobRow } from '@/components/JobRow'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { useRepository } from '@/lib/repository'
import type { FeedbackAction, JobStatus, JobWithStatus } from '@/types'

type TabValue = 'all' | JobStatus

const tabs: { value: TabValue; label: string }[] = [
  { value: 'all', label: '全部' },
  { value: 'interested', label: '感兴趣' },
  { value: 'pass', label: '不合适' },
  { value: 'applied', label: '已投递' },
]

export default function JobsPage() {
  const repo = useRepository()
  const navigate = useNavigate()
  const [tab, setTab] = useState<TabValue>('all')
  const [sort, setSort] = useState<'score' | 'time'>('score')
  const [jobs, setJobs] = useState<JobWithStatus[]>([])

  const reload = useCallback(async () => {
    const list = await repo.listJobs(tab === 'all' ? undefined : tab, sort)
    // 「全部」tab 排除「不合适」（纯前端过滤；反馈事件保留，「不合适」tab 完整不变）
    setJobs(tab === 'all' ? list.filter((j) => j.status !== 'pass') : list)
  }, [repo, tab, sort])

  useEffect(() => {
    void reload()
  }, [reload])

  // 变更后无需手动 reload：repo 随 App 状态更新生成新实例，
  // 上面的 effect 会随之重新拉取（手动 reload 反而会用过期闭包覆盖新数据）
  const handleFeedback = async (
    jobId: string,
    action: FeedbackAction,
    reason: string | null,
    comment: string,
  ) => {
    await repo.addFeedback(jobId, action, reason, comment)
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Tabs value={tab} onValueChange={(v) => setTab(v as TabValue)}>
          <TabsList>
            {tabs.map((t) => (
              <TabsTrigger key={t.value} value={t.value}>
                {t.label}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
        <div className="flex items-center gap-3">
          {/* M4：排序切换（匹配分降序=默认，30 天无反馈沉底；按时间=采集时间倒序） */}
          <div className="flex items-center gap-1 text-sm">
            {(
              [
                { value: 'score', label: '按匹配分' },
                { value: 'time', label: '按时间' },
              ] as const
            ).map((s) => (
              <button
                key={s.value}
                type="button"
                onClick={() => setSort(s.value)}
                className={`rounded-md px-2 py-1 transition-colors ${
                  sort === s.value
                    ? 'bg-accent font-medium text-accent-foreground'
                    : 'text-muted-foreground hover:bg-muted'
                }`}
              >
                {s.label}
              </button>
            ))}
          </div>
          <span className="text-sm text-muted-foreground tabular-nums">共 {jobs.length} 条</span>
        </div>
      </div>

      {jobs.length === 0 ? (
        tab === 'all' ? (
          <EmptyState
            icon={Inbox}
            title="暂无岗位"
            description="采集器接入后，匹配岗位会出现在这里。先去设置好筛选偏好。"
            actionLabel="去设置偏好"
            onAction={() => navigate('/preferences')}
          />
        ) : (
          <EmptyState
            icon={Inbox}
            title={`没有「${tabs.find((t) => t.value === tab)?.label}」状态的岗位`}
            description="标记反馈后，岗位会进入对应状态分组。"
            actionLabel="查看全部岗位"
            onAction={() => setTab('all')}
          />
        )
      ) : (
        <div className="rounded-lg border bg-card [&>*+*]:border-t-[0.5px] [&>*+*]:border-border">
          {jobs.map((job) => (
            <JobRow key={job.id} job={job} onFeedback={handleFeedback} />
          ))}
        </div>
      )}
    </div>
  )
}
