import { useMemo, useState } from 'react'
import type {
  FeedbackAction,
  FeedbackEvent,
  InterviewQuestion,
  Job,
  JobStatus,
  JobWithStatus,
  Material,
  Preferences,
} from '@/types'
import type { Repository } from './repository'

// 生成可读性较好的假 UUID（仅骨架阶段使用）
const uuid = (n: number) =>
  `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`

// ---------- 假数据：10 条岗位（4 new / 2 interested / 2 pass / 2 applied） ----------

const seedJobs: Job[] = [
  {
    id: uuid(1),
    title: 'AI 产品经理',
    company: '月之暗面',
    location: '北京',
    salaryMin: 30000,
    salaryMax: 60000,
    currency: 'CNY',
    source: 'boss',
    sourceUrl: 'https://www.zhipin.com/job_detail/mock001',
    description:
      '负责 Kimi 智能助手的产品规划与迭代。深入理解大模型能力边界，设计面向 C 端用户的 AI 交互体验；与算法、工程团队紧密协作，推动模型能力产品化落地。要求 3 年以上互联网产品经验，对 LLM 有强烈兴趣，有 AI 产品经验者优先。',
    postedAt: '2026-11-03',
    collectedAt: '2026-11-04T01:00:00Z',
    dedupKey: 'd41d8cd98f00b204e9800998ecf8427e',
  },
  {
    id: uuid(2),
    title: '数据分析师',
    company: '小红书',
    location: '上海',
    salaryMin: 25000,
    salaryMax: 40000,
    currency: 'CNY',
    source: 'boss',
    sourceUrl: 'https://www.zhipin.com/job_detail/mock002',
    description:
      '负责社区内容生态的数据分析工作，搭建内容质量评估指标体系，输出洞察并推动业务决策。要求熟练掌握 SQL，有扎实的统计学基础，熟悉 Python/R 者优先，有社区或内容行业经验者优先。',
    postedAt: '2026-11-02',
    collectedAt: '2026-11-04T01:00:00Z',
    dedupKey: 'c4ca4238a0b923820dcc509a6f75849b',
  },
  {
    id: uuid(3),
    title: '高级产品经理（增长方向）',
    company: '字节跳动',
    location: '上海',
    salaryMin: 35000,
    salaryMax: 55000,
    currency: 'CNY',
    source: 'lagou',
    sourceUrl: 'https://www.lagou.com/jobs/mock003.html',
    description:
      '负责抖音电商用户增长策略，通过数据驱动发现增长机会，设计并落地增长实验。要求 5 年以上增长产品经验，熟悉 A/B 实验设计与分析，有电商平台经验者优先。',
    postedAt: '2026-10-30',
    collectedAt: '2026-11-03T01:00:00Z',
    dedupKey: 'c81e728d9d4c2f636f067f89cc14862c',
  },
  {
    id: uuid(4),
    title: '产品运营专员',
    company: '拼多多',
    location: '上海',
    salaryMin: 18000,
    salaryMax: 25000,
    currency: 'CNY',
    source: 'boss',
    sourceUrl: 'https://www.zhipin.com/job_detail/mock004',
    description:
      '负责平台活动的策划与执行，跟进活动数据并输出复盘报告；协调设计、研发资源推进活动上线。要求 1-3 年运营经验，执行力强，抗压能力好。',
    postedAt: '2026-11-01',
    collectedAt: '2026-11-03T01:00:00Z',
    dedupKey: 'eccbc87e4b5ce2fe28308fd9f2a7baf3',
  },
  {
    id: uuid(5),
    title: 'Agent 平台产品经理',
    company: 'MiniMax',
    location: '上海',
    salaryMin: 40000,
    salaryMax: 65000,
    currency: 'CNY',
    source: '公司官网',
    sourceUrl: 'https://careers.minimaxi.com/jobs/mock005',
    description:
      '负责 Agent 开放平台的产品设计，包括任务编排、工具调用、多智能体协作等核心能力。需要深入理解开发者需求，抽象出通用平台能力。要求有技术背景或 AI 平台产品经验，熟悉主流 Agent 框架者优先。',
    postedAt: '2026-11-04',
    collectedAt: '2026-11-05T01:00:00Z',
    dedupKey: 'a87ff679a2f3e71d9181a67b7542122c',
  },
  {
    id: uuid(6),
    title: '商业数据分析师',
    company: '美团',
    location: '北京',
    salaryMin: 25000,
    salaryMax: 35000,
    currency: 'CNY',
    source: 'boss',
    sourceUrl: 'https://www.zhipin.com/job_detail/mock006',
    description:
      '支持到家事业群的商业分析工作，围绕供需匹配、履约效率等核心议题开展专题分析，输出策略建议。要求 2 年以上分析经验，SQL 熟练，具备良好的商业敏感度。',
    postedAt: '2026-11-01',
    collectedAt: '2026-11-04T01:00:00Z',
    dedupKey: 'e4da3b7fbbce2345d7772b0674a318d5',
  },
  {
    id: uuid(7),
    title: '用户增长经理',
    company: '滴滴',
    location: '北京',
    salaryMin: 30000,
    salaryMax: 45000,
    currency: 'CNY',
    source: 'lagou',
    sourceUrl: 'https://www.lagou.com/jobs/mock007.html',
    description:
      '负责网约车乘客端的拉新与促活，制定渠道投放策略，优化转化漏斗。要求 3 年以上增长经验，熟悉各投放渠道，数据驱动。',
    postedAt: '2026-10-29',
    collectedAt: '2026-11-02T01:00:00Z',
    dedupKey: '1679091c5a880faf6fb5e6087eb1b2dc',
  },
  {
    id: uuid(8),
    title: 'AI 应用工程师',
    company: '智谱AI',
    location: '北京',
    salaryMin: 35000,
    salaryMax: 60000,
    currency: 'CNY',
    source: '公司官网',
    sourceUrl: 'https://zhipuai.jobs.feishu.cn/mock008',
    description:
      '基于 GLM 系列模型构建企业级 AI 应用，包括 RAG 知识库、智能客服、Agent 工作流等。要求扎实的工程能力，熟悉 LangChain/LlamaIndex 等框架，有 LLM 应用落地经验。',
    postedAt: '2026-11-03',
    collectedAt: '2026-11-05T01:00:00Z',
    dedupKey: '8f14e45fceea167a5a36dedd4bea2543',
  },
  {
    id: uuid(9),
    title: '产品经理（SaaS 方向）',
    company: '飞书',
    location: '上海',
    salaryMin: 30000,
    salaryMax: 50000,
    currency: 'CNY',
    source: 'boss',
    sourceUrl: 'https://www.zhipin.com/job_detail/mock009',
    description:
      '负责飞书多维表格的产品迭代，深入企业客户场景，设计提升协作效率的功能。要求 3 年以上 SaaS 产品经验，有 B 端复杂系统设计经验，对效率工具有热情。',
    postedAt: '2026-10-28',
    collectedAt: '2026-11-02T01:00:00Z',
    dedupKey: 'c9f0f895fb98ab9159f51fd0297e236d',
  },
  {
    id: uuid(10),
    title: '内容策略运营',
    company: '哔哩哔哩',
    location: '上海',
    salaryMin: 15000,
    salaryMax: 22000,
    currency: 'CNY',
    source: 'boss',
    sourceUrl: 'https://www.zhipin.com/job_detail/mock010',
    description:
      '负责知识区内容的策略运营，制定内容分发策略，挖掘优质创作者。要求熟悉 B 站内容生态，有内容sense，数据分析能力加分。',
    postedAt: '2026-11-04',
    collectedAt: '2026-11-05T02:00:00Z',
    dedupKey: '45c48cce2e2d7fbdea1afc51c7c6ad26',
  },
]

const seedFeedbackEvents: FeedbackEvent[] = [
  { id: uuid(101), jobId: uuid(2), action: 'interested', comment: 'AI 方向匹配，团队风评不错', createdAt: '2026-11-04T03:00:00Z' },
  { id: uuid(102), jobId: uuid(3), action: 'applied', comment: '官网已投递，等 HR 联系', createdAt: '2026-11-03T06:30:00Z' },
  { id: uuid(103), jobId: uuid(4), action: 'pass', comment: '太偏运营了，不是产品方向', createdAt: '2026-11-03T08:00:00Z' },
  { id: uuid(104), jobId: uuid(5), action: 'interested', comment: 'Agent 平台方向很对口', createdAt: '2026-11-05T01:30:00Z' },
  { id: uuid(105), jobId: uuid(7), action: 'pass', comment: 'base 北京，通勤不考虑', createdAt: '2026-11-02T09:00:00Z' },
  { id: uuid(106), jobId: uuid(9), action: 'interested', comment: null, createdAt: '2026-11-02T10:00:00Z' },
  { id: uuid(107), jobId: uuid(9), action: 'applied', comment: '内推渠道投递', createdAt: '2026-11-03T02:00:00Z' },
]

const seedMaterials: Material[] = [
  {
    id: uuid(201),
    project: '电商数据中台',
    title: '从 0 到 1 搭建经营分析指标体系',
    role: '数据分析师',
    duration: '2023.03–2024.06',
    capabilityL1: '数据分析',
    capabilityL2: '指标体系搭建',
    tags: ['SQL', '看板', '北极星指标'],
    metrics: '报表人力成本下降 60%，核心指标口径统一至 42 个',
    content:
      '## 背景\n业务高速增长期，各团队指标口径混乱，同一份 GMV 有三个数字。\n\n## 过程\n梳理业务流程，与 6 个业务方逐一对齐口径，按 OSM 模型拆解出三级指标体系，落地到统一看板。\n\n## 结果\n口径统一后，经营例会效率明显提升，临时取数需求下降七成。',
    others: null,
    updatedAt: '2026-10-20T08:00:00Z',
  },
  {
    id: uuid(202),
    project: '电商数据中台',
    title: '大促复盘：GMV 预估偏差从 25% 收敛到 8%',
    role: '数据分析师',
    duration: '2023.09–2023.11',
    capabilityL1: '数据分析',
    capabilityL2: '预测与复盘',
    tags: ['预测', '复盘'],
    metrics: 'GMV 预估偏差 25% → 8%',
    content:
      '## 背景\n双 11 备货依赖 GMV 预估，往年偏差高达 25%。\n\n## 过程\n拆解偏差来源，发现主要误差来自新客贡献；引入分渠道滚动预测，每 6 小时校准一次。\n\n## 结果\n最终偏差收敛到 8%，备货损耗显著下降。',
    others: null,
    updatedAt: '2026-10-20T08:00:00Z',
  },
  {
    id: uuid(203),
    project: '会员增长项目',
    title: '设计会员分层运营策略，付费转化提升 18%',
    role: '增长产品经理',
    duration: '2022.06–2023.02',
    capabilityL1: '用户增长',
    capabilityL2: '分层运营',
    tags: ['A/B测试', '留存'],
    metrics: '付费转化率 +18%，次月留存 +6pp',
    content:
      '## 背景\n会员增长停滞，粗放式补贴 ROI 持续走低。\n\n## 过程\n按 RFM 模型把用户分为 5 层，针对高潜力层设计定向权益包，A/B 实验验证后全量。\n\n## 结果\n付费转化率提升 18%，补贴费用反而下降 12%。',
    others: null,
    updatedAt: '2026-10-21T08:00:00Z',
  },
  {
    id: uuid(204),
    project: '会员增长项目',
    title: 'Push 推送全链路优化：打开率翻倍',
    role: '增长产品经理',
    duration: '2022.09–2022.12',
    capabilityL1: '用户增长',
    capabilityL2: '消息触达',
    tags: ['push', '文案', '频控'],
    metrics: 'push 打开率 2.1% → 4.3%',
    content:
      '## 背景\npush 打开率长期低于行业均值。\n\n## 过程\n从发送时段、文案个性化、频控策略三个维度做实验矩阵，逐步全量最优组合。\n\n## 结果\n打开率翻倍，且卸载率没有上升。',
    others: null,
    updatedAt: '2026-10-21T08:00:00Z',
  },
  {
    id: uuid(205),
    project: '内部效率工具',
    title: '用 LLM 搭建客服知识库问答机器人',
    role: '独立负责人',
    duration: '2024.01–2024.05',
    capabilityL1: '技术工程',
    capabilityL2: 'LLM 应用',
    tags: ['RAG', 'LangChain'],
    metrics: '人工客服工单量下降 35%，首解率 82%',
    content:
      '## 背景\n客服团队 60% 工单是重复问题。\n\n## 过程\n基于 RAG 架构搭建知识库问答机器人，设计评测集持续优化召回质量，灰度上线后迭代三轮。\n\n## 结果\n工单量下降 35%，机器人首解率达到 82%。',
    others: null,
    updatedAt: '2026-10-22T08:00:00Z',
  },
]

const seedQuestions: InterviewQuestion[] = [
  {
    id: uuid(301),
    category: '项目深挖',
    question: '介绍一下你从 0 到 1 搭建指标体系的过程，最大的难点是什么？',
    answerDraft:
      '先讲口径混乱的痛点，再讲 OSM 拆解思路。难点是跨团队对齐口径——用"指标Owner制"解决争议。',
    linkedMaterialId: uuid(201),
    confidence: 4,
    updatedAt: '2026-10-25T08:00:00Z',
  },
  {
    id: uuid(302),
    category: '项目深挖',
    question: 'GMV 预估模型是怎么迭代的？过程中踩过什么坑？',
    answerDraft: '滚动预测 + 分渠道拆解；坑：大促首日数据噪声大，过早校准反而更差。',
    linkedMaterialId: uuid(202),
    confidence: 3,
    updatedAt: '2026-10-25T08:00:00Z',
  },
  {
    id: uuid(303),
    category: '行为面',
    question: '讲一次你和研发发生分歧的经历，你是怎么处理的？',
    answerDraft: '用数据说话：先对齐目标，再用小成本实验验证分歧点。',
    linkedMaterialId: null,
    confidence: 3,
    updatedAt: '2026-10-25T08:00:00Z',
  },
  {
    id: uuid(304),
    category: '行为面',
    question: '你遇到过最大的失败是什么？从中学到了什么？',
    answerDraft: null,
    linkedMaterialId: null,
    confidence: 2,
    updatedAt: '2026-10-25T08:00:00Z',
  },
  {
    id: uuid(305),
    category: '技术概念',
    question: '如何评估一个 RAG 系统的效果？',
    answerDraft: '离线评测集（召回率/忠实度）+ 在线指标（首解率、转人工率）。',
    linkedMaterialId: uuid(205),
    confidence: 4,
    updatedAt: '2026-10-26T08:00:00Z',
  },
  {
    id: uuid(306),
    category: '技术概念',
    question: '解释一下 A/B 测试中的辛普森悖论。',
    answerDraft: null,
    linkedMaterialId: null,
    confidence: null,
    updatedAt: '2026-10-26T08:00:00Z',
  },
]

const seedPreferences: Preferences = {
  id: uuid(401),
  industries: ['互联网', '人工智能'],
  roles: ['产品经理', '数据分析师'],
  locations: ['上海', '远程'],
  salaryMin: 25000,
  keywordsInclude: ['AI', '大模型', 'Agent'],
  keywordsExclude: ['销售', '外包', '驻场'],
  updatedAt: '2026-10-20T08:00:00Z',
}

// ---------- 派生状态 ----------

/** 岗位状态由最新一条反馈事件派生；无事件则为 new */
function deriveStatus(events: FeedbackEvent[]): JobStatus {
  if (events.length === 0) return 'new'
  return events.reduce((latest, e) => (e.createdAt > latest.createdAt ? e : latest)).action
}

function withStatus(job: Job, events: FeedbackEvent[]): JobWithStatus {
  const jobEvents = events
    .filter((e) => e.jobId === job.id)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  return { ...job, status: deriveStatus(jobEvents), feedbackEvents: jobEvents }
}

// ---------- 内存实现 ----------

/**
 * 内存版 Repository：数据保存在 React state 中，仅用于骨架阶段。
 * M2 将用 Postgres 实现替换（见 README）。
 */
export function useMemoryRepository(): Repository {
  const [jobs] = useState<Job[]>(seedJobs)
  const [feedbackEvents, setFeedbackEvents] = useState<FeedbackEvent[]>(seedFeedbackEvents)
  const [materials, setMaterials] = useState<Material[]>(seedMaterials)
  const [questions, setQuestions] = useState<InterviewQuestion[]>(seedQuestions)
  const [preferences, setPreferences] = useState<Preferences>(seedPreferences)

  return useMemo<Repository>(
    () => ({
      async listJobs(status?: JobStatus) {
        const all = jobs
          .map((j) => withStatus(j, feedbackEvents))
          .sort((a, b) => b.collectedAt.localeCompare(a.collectedAt))
        return status ? all.filter((j) => j.status === status) : all
      },

      async getJob(id: string) {
        const job = jobs.find((j) => j.id === id)
        return job ? withStatus(job, feedbackEvents) : null
      },

      async addFeedback(jobId: string, action: FeedbackAction, comment?: string) {
        const event: FeedbackEvent = {
          id: crypto.randomUUID(),
          jobId,
          action,
          comment: comment?.trim() ? comment.trim() : null,
          createdAt: new Date().toISOString(),
        }
        setFeedbackEvents((prev) => [...prev, event])
      },

      async listMaterials() {
        return [...materials].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
      },

      async saveMaterial(material: Material) {
        const saved = { ...material, updatedAt: new Date().toISOString() }
        setMaterials((prev) => {
          const exists = prev.some((m) => m.id === saved.id)
          return exists ? prev.map((m) => (m.id === saved.id ? saved : m)) : [...prev, saved]
        })
        return saved
      },

      async deleteMaterial(id: string) {
        setMaterials((prev) => prev.filter((m) => m.id !== id))
        // 解除问题库中对该故事的关联
        setQuestions((prev) =>
          prev.map((q) => (q.linkedMaterialId === id ? { ...q, linkedMaterialId: null } : q)),
        )
      },

      async listQuestions() {
        return [...questions].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
      },

      async saveQuestion(question: InterviewQuestion) {
        const saved = { ...question, updatedAt: new Date().toISOString() }
        setQuestions((prev) => {
          const exists = prev.some((q) => q.id === saved.id)
          return exists ? prev.map((q) => (q.id === saved.id ? saved : q)) : [...prev, saved]
        })
        return saved
      },

      async getPreferences() {
        return preferences
      },

      async savePreferences(p: Preferences) {
        const saved = { ...p, updatedAt: new Date().toISOString() }
        setPreferences(saved)
        return saved
      },
    }),
    [jobs, feedbackEvents, materials, questions, preferences],
  )
}
