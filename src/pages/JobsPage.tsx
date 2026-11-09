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
  const [jobs, setJobs] = useState<JobWithStatus[]>([])

  const reload = useCallback(async () => {
    setJobs(await repo.listJobs(tab === 'all' ? undefined : tab))
  }, [repo, tab])

  useEffect(() => {
    void reload()
  }, [reload])

  // 变更后无需手动 reload：repo 随 App 状态更新生成新实例，
  // 上面的 effect 会随之重新拉取（手动 reload 反而会用过期闭包覆盖新数据）
  const handleFeedback = async (jobId: string, action: FeedbackAction, comment: string) => {
    await repo.addFeedback(jobId, action, comment)
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
        <span className="text-sm text-muted-foreground tabular-nums">共 {jobs.length} 条</span>
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
