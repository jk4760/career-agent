import { createContext, useContext } from 'react'
import type {
  AISettings,
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
  /**
   * 对全部 materials 的 facets 去重并计数，返回按 count 降序的列表。
   * chips 完全由数据派生：某 value 的最后一条引用被移除后，chip 自动消失。
   */
  listFacets(): Promise<{ value: string; count: number }[]>

  listQuestions(): Promise<InterviewQuestion[]>
  saveQuestion(question: InterviewQuestion): Promise<InterviewQuestion>
  deleteQuestion(id: string): Promise<void>

  /**
   * 附件本体存取（10.9）：attachments 元信息随 saveMaterial 写入，
   * 文件本体由这两个方法单独存取。内存实现仅存会话内变量，刷新后丢失；
   * M2 接后端 + 对象存储后替换实现。
   */
  putAttachmentFile(materialId: string, file: File): Promise<void>
  getAttachmentFile(materialId: string, name: string): Promise<File | null>

  getPreferences(): Promise<Preferences>
  savePreferences(preferences: Preferences): Promise<Preferences>

  /** AI 对话配置（6.7）：localStorage 持久化，保存后面板模型下拉立即联动 */
  getAISettings(): Promise<AISettings>
  saveAISettings(settings: AISettings): Promise<AISettings>
}

export const RepositoryContext = createContext<Repository | null>(null)

export function useRepository(): Repository {
  const repo = useContext(RepositoryContext)
  if (!repo) {
    throw new Error('useRepository must be used within a RepositoryContext.Provider')
  }
  return repo
}
