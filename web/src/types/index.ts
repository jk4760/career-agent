// Career Agent 实体类型定义
// 与 db/schema.sql 一一对应（字段命名从 snake_case 转为 camelCase）

/** 反馈动作（feedback_events.action 的受控取值） */
export type FeedbackAction = 'interested' | 'pass' | 'applied'

/** M4：结构化反馈维度——不合适必选六选一；感兴趣可选三选 */
export const PASS_REASONS = ['职能', '薪资', '地点', '职级', '公司', '其他'] as const
export const INTERESTED_REASONS = ['职能对口', '薪资满意', '公司想去'] as const

/** M4：岗位打分的可解释结构（api 实时计算） */
export interface ScoreBreakdown {
  final: number
  llm: number | null
  rule: number
  ruleDims: { role: number; salary: number; company: number; freshness: number; experience: number }
  /** true = LLM 分缺失，按规则参考分排序（降级） */
  usedFallback: boolean
  feedback: { total: number; items: { keyword: string; delta: number; action: string }[] }
  ruleFacts: string[]
  llmReasons: string[]
  /** v1.1+：LLM 一句话看点；未评分/旧版本为空串 */
  llmHighlight: string
}

/** M4：LLM 主导分缓存（jobs.llm_eval） */
export interface LlmEval {
  score: number
  reasons: string[]
  prompt_version: string
  scored_at: string
}

/**
 * 岗位派生状态：
 * - new：该岗位没有任何反馈事件
 * - 其余：取该岗位最新一条 feedback_event 的 action
 */
export type JobStatus = 'new' | FeedbackAction

export interface Job {
  id: string
  title: string
  company: string
  location: string | null
  salaryMin: number | null
  salaryMax: number | null
  currency: string
  source: string
  sourceUrl: string
  description: string | null
  /** ISO 日期（YYYY-MM-DD） */
  postedAt: string | null
  /** ISO 时间戳 */
  collectedAt: string
  dedupKey: string
  /** M4：LLM 评分缓存；null = 未评分/评分失败（走规则分降级） */
  llmEval: LlmEval | null
}

export interface FeedbackEvent {
  id: string
  jobId: string
  action: FeedbackAction
  reason: string | null
  comment: string | null
  createdAt: string
}

/** 岗位 + 派生状态 + 反馈历史（列表/详情视图使用） */
export interface JobWithStatus extends Job {
  status: JobStatus
  feedbackEvents: FeedbackEvent[]
  score: ScoreBreakdown
}

export interface Preferences {
  id: string
  industries: string[]
  roles: string[]
  locations: string[]
  salaryMin: number | null
  keywordsInclude: string[]
  keywordsExclude: string[]
  /** 可接受的岗位经验要求上限（年）；null = 不限 */
  experienceMin: number | null
  /** M4：个人背景自述（300–500 字），注入 LLM 评分 */
  backgroundText: string | null
  updatedAt: string
}

/** 附件元信息（10.9）；文件本体在内存实现中仅存于会话，刷新后丢失 */
export interface AttachmentMeta {
  name: string
  size: number
  mime: string
  importedAt: string
}

/** 素材库条目：一行 = 一个可讲的故事 */
export interface Material {
  id: string
  project: string
  title: string
  role: string | null
  duration: string | null
  capabilityL1: string | null
  capabilityL2: string | null
  tags: string[]
  /** 经历/公司标签（自由文本、不分类型）；素材库 chips 由该字段派生 */
  facets: string[]
  metrics: string | null
  /** markdown，自由结构（不强制 STAR 四段） */
  content: string | null
  attachments: AttachmentMeta[]
  others: Record<string, unknown> | null
  updatedAt: string
}

export interface InterviewQuestion {
  id: string
  category: string | null
  question: string
  /** markdown 回答草稿 */
  answerDraft: string | null
  linkedMaterialId: string | null
  /** 把握度 1–5 */
  confidence: number | null
  updatedAt: string
}

export interface PushLog {
  id: string
  jobId: string | null
  channel: string
  pushedAt: string
  userReply: string | null
}

/**
 * AI 对话配置（6.7）：单个 OpenAI 兼容服务，不做多服务商配置（留 M5）。
 * localStorage 持久化（§7 豁免条款第二条）；API Key 仅本机存储，不提交任何服务器。
 */
export interface AISettings {
  baseUrl: string
  apiKey: string
  models: string[]
}

/** 能力域受控词表（capability_l1，只服务筛选，不承担身份） */
export const CAPABILITY_L1_OPTIONS = [
  '数据分析',
  '用户增长',
  '产品设计',
  '项目管理',
  '技术工程',
  '商业分析',
] as const

/** 问题库分类（受控取值） */
export const QUESTION_CATEGORIES = ['项目深挖', '行为面', '技术概念', '其他'] as const
