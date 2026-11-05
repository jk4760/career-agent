import { useCallback, useEffect, useState } from 'react'
import { JobCard } from '@/components/JobCard'
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
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">岗位流</h1>
        <span className="text-sm text-muted-foreground">共 {jobs.length} 条</span>
      </div>

      <Tabs value={tab} onValueChange={(v) => setTab(v as TabValue)}>
        <TabsList>
          {tabs.map((t) => (
            <TabsTrigger key={t.value} value={t.value}>
              {t.label}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>

      {jobs.length === 0 ? (
        <p className="py-16 text-center text-sm text-muted-foreground">该状态下暂无岗位</p>
      ) : (
        <div className="space-y-3">
          {jobs.map((job) => (
            <JobCard key={job.id} job={job} onFeedback={handleFeedback} />
          ))}
        </div>
      )}
    </div>
  )
}
