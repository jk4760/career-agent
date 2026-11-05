import { createContext, useContext } from 'react'
import type {
  FeedbackAction,
  InterviewQuestion,
  JobStatus,
  JobWithStatus,
  Material,
  Preferences,
} from '@/types'

/**
 * 数据访问层接口。
 * 骨架阶段由 memoryRepository 实现（内存 + 假数据）；
 * M2 将用 Postgres 实现同一接口进行替换，页面代码无需改动。
 */
export interface Repository {
  /** 按派生状态筛选岗位，不传则返回全部，按采集时间倒序 */
  listJobs(status?: JobStatus): Promise<JobWithStatus[]>
  getJob(id: string): Promise<JobWithStatus | null>
  /** 追加一条反馈事件（不改写历史；岗位派生状态由最新事件决定） */
  addFeedback(jobId: string, action: FeedbackAction, comment?: string): Promise<void>

  listMaterials(): Promise<Material[]>
  /** 新建或更新（按 id 判断），返回保存后的实体 */
  saveMaterial(material: Material): Promise<Material>
  deleteMaterial(id: string): Promise<void>

  listQuestions(): Promise<InterviewQuestion[]>
  saveQuestion(question: InterviewQuestion): Promise<InterviewQuestion>

  getPreferences(): Promise<Preferences>
  savePreferences(preferences: Preferences): Promise<Preferences>
}

export const RepositoryContext = createContext<Repository | null>(null)

export function useRepository(): Repository {
  const repo = useContext(RepositoryContext)
  if (!repo) {
    throw new Error('useRepository must be used within a RepositoryContext.Provider')
  }
  return repo
}
