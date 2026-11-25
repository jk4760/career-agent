// M4 施工项 2/3：打分与可解释结构（api 实时计算，规则分不落库）
// 最终排序分 = LLM 主导分（jobs.llm_eval 缓存）+ 反馈调整；LLM 缺失 → 规则参考分 + 反馈调整
import { sql } from 'drizzle-orm'
import { db } from './db'

export interface Prefs {
  roles: string[]
  locations: string[]
  salaryMin: number | null
  keywordsInclude: string[]
  keywordsExclude: string[]
  experienceMin: number | null
  backgroundText: string | null
}

export interface JobRow {
  id: string
  title: string
  company: string
  location: string | null
  salaryMin: number | null
  salaryMax: number | null
  source: string
  sourceUrl: string
  description: string | null
  postedAt: string | null
  collectedAt: Date
  llmEval: {
    score: number
    reasons: string[]
    highlight?: string
    prompt_version: string
    scored_at: string
  } | null
}

export interface ScoreBreakdown {
  final: number
  llm: number | null
  rule: number
  /** 修复批项 5：五维改四维，新鲜度移出评分（「7 天内」仅作事实标签） */
  ruleDims: { role: number; salary: number; company: number; experience: number }
  usedFallback: boolean
  feedback: { total: number; items: { keyword: string; delta: number; action: string }[] }
  ruleFacts: string[]
  llmReasons: string[]
  /** v1.1+：LLM 一句话看点；未评分/旧版本为空串 */
  llmHighlight: string
}

// 公司分层（与 collector/config.yaml §official.companies 同步；别名兼容猎聘侧公司名写法）
const STAR_COMPANIES: Record<string, string[]> = {
  '字节跳动 / TikTok': ['字节跳动', '抖音', 'TikTok', 'ByteDance'],
  小红书: ['小红书'],
  '美团 / 大众点评': ['美团', '大众点评'],
  哔哩哔哩: ['哔哩哔哩', 'B站', 'bilibili'],
  腾讯: ['腾讯'],
  MiniMax: ['MiniMax'],
  XTransfer: ['XTransfer'],
  携程集团: ['携程'],
  华泰证券: ['华泰'],
  'Soul App': ['Soul'],
}
const WATCH_COMPANIES: Record<string, string[]> = {
  'Amazon Ads': ['Amazon', '亚马逊'],
  'The Trade Desk': ['Trade Desk', 'TTD'],
  哈啰: ['哈啰'],
  喜马拉雅: ['喜马拉雅'],
  叮咚买菜: ['叮咚买菜', '叮咚'],
  即刻: ['即刻'],
  美柚: ['美柚'],
  网易游戏: ['网易'],
  商汤科技: ['商汤', 'SenseTime'],
  传音控股: ['传音', 'TRANSSION'],
  微软: ['微软', 'Microsoft'],
  甄知科技: ['甄知'],
  东方财富: ['东方财富'],
  国金证券: ['国金证券', '国金'],
  冰鉴科技: ['冰鉴'],
  'Airwallex 空中云汇': ['Airwallex', '空中云汇'],
  PayerMax: ['PayerMax'],
  汇付天下: ['汇付'],
  易鑫集团: ['易鑫'],
  数禾科技: ['数禾'],
  拼多多: ['拼多多', 'PDD', 'Temu'],
  阿里: ['阿里', 'Alibaba', '淘宝', '天猫', '蚂蚁'],
}

function companyTier(company: string): { tier: 'star' | 'watch' | 'other'; name: string | null } {
  const low = company.toLowerCase()
  for (const [name, aliases] of Object.entries(STAR_COMPANIES)) {
    if (aliases.some((a) => low.includes(a.toLowerCase()))) return { tier: 'star', name }
  }
  for (const [name, aliases] of Object.entries(WATCH_COMPANIES)) {
    if (aliases.some((a) => low.includes(a.toLowerCase()))) return { tier: 'watch', name }
  }
  return { tier: 'other', name: null }
}

function hitAny(text: string, keywords: string[]): string[] {
  const low = text.toLowerCase()
  return keywords.filter((k) => k && low.includes(k.toLowerCase()))
}

/** JD 文本提取经验上限（与 collector match.py extract_max_years 同规则） */
function extractMaxYears(text: string): number | null {
  let best: number | null = null
  for (const m of text.matchAll(/(\d+)\s*(?:-|~|—|–|到|至)\s*(\d+)\s*年/g)) {
    const v = parseInt(m[2], 10)
    best = best === null ? v : Math.max(best, v)
  }
  for (const m of text.matchAll(/(\d+)\s*年以上/g)) {
    const v = parseInt(m[1], 10)
    best = best === null ? v : Math.max(best, v)
  }
  return best
}

function daysSince(dateStr: string | null, now: Date): number | null {
  if (!dateStr) return null
  const d = new Date(dateStr)
  if (Number.isNaN(d.getTime())) return null
  return Math.floor((now.getTime() - d.getTime()) / 86400000)
}

/** 规则四维参考分（修复批项 5：新鲜度移出评分；职能 40/薪资 20/公司 20/经验 20，信息缺失一律中性档） */
export function ruleScore(
  job: JobRow,
  prefs: Prefs,
  now: Date,
): { total: number; dims: ScoreBreakdown['ruleDims']; facts: string[] } {
  const jd = job.description || ''
  const facts: string[] = []

  // 职能 40：title 精确命中 roles=40；title 命中 include=28；仅 JD 命中=14
  let role = 0
  if (hitAny(job.title, prefs.roles).length) role = 40
  else if (hitAny(job.title, prefs.keywordsInclude).length) role = 28
  else if (hitAny(jd, prefs.roles).length || hitAny(jd, prefs.keywordsInclude).length) role = 14

  // 薪资 20：上限≥预期×1.2=20；≥预期=15；略低=5；面议/无数据=10（中性）
  let salary = 10
  if (prefs.salaryMin && job.salaryMax) {
    if (job.salaryMax >= prefs.salaryMin * 1.2) salary = 20
    else if (job.salaryMax >= prefs.salaryMin) salary = 15
    else salary = 5
  }
  if (salary === 20) facts.push('薪资超预期 20%')
  else if (salary >= 15) facts.push('薪资达标')

  // 公司 20：★10 家=20；监控清单=12；清单外=5
  const tier = companyTier(job.company)
  const company = tier.tier === 'star' ? 20 : tier.tier === 'watch' ? 12 : 5
  if (tier.tier === 'star') facts.push('★目标公司')

  // 新鲜度：不进分数（静态分不承载时变维度）；「7 天内」仅作事实标签
  const age = daysSince(job.postedAt, now)
  if (age !== null && age <= 7) facts.push('7 天内')

  // 经验 20：上限≤experience_min=20；接近（+2 内）=13；提取不到=10（中性）；远超=7
  let experience = 10
  const years = extractMaxYears(jd)
  if (prefs.experienceMin && years !== null) {
    if (years <= prefs.experienceMin) experience = 20
    else if (years <= prefs.experienceMin + 2) experience = 13
    else experience = 7
  }
  if (experience === 20) facts.push('经验匹配')

  return {
    total: role + salary + company + experience,
    dims: { role, salary, company, experience },
    facts,
  }
}

interface FeedbackEventRow {
  jobId: string
  action: string
  reason?: string | null
  createdAt: Date
  canceledAt?: Date | null
}

/** 反馈调整层（§3.1）：不合适 −20 / 感兴趣 +10，职能词连坐，60 天硬衰减，事件本岗除外；每岗仅取最新一条相关反馈调整一次 */
export function feedbackAdjustments(
  jobs: JobRow[],
  events: FeedbackEventRow[],
  prefs: Prefs,
  now: Date,
): Map<string, ScoreBreakdown['feedback']> {
  const keywords = [...prefs.roles, ...prefs.keywordsInclude].filter(Boolean)
  const result = new Map<string, ScoreBreakdown['feedback']>()
  const cutoff = 60
  const active = events
    .filter((e) => !e.canceledAt)
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
  const adjustments = active.flatMap((e) => {
    const age = daysSince(e.createdAt.toISOString(), now)
    if (age === null || age > cutoff) return []
    const src = jobs.find((j) => j.id === e.jobId)
    if (!src) return []
    const hits = hitAny(src.title, keywords)
    const delta = e.action === 'pass' ? -20 : e.action === 'interested' && e.reason !== '面试练习' ? 10 : 0
    return hits.map((keyword) => ({ jobId: e.jobId, keyword, delta, action: e.action }))
  })
  for (const job of jobs) {
    const latest = adjustments.find(
      (a) => a.jobId !== job.id && a.delta !== 0 && hitAny(job.title, [a.keyword]).length,
    )
    if (latest) {
      result.set(job.id, {
        total: latest.delta,
        items: [{ keyword: latest.keyword, delta: latest.delta, action: latest.action }],
      })
    }
  }
  return result
}

/** 汇总一个岗位的可解释打分结构 */
export function buildScore(
  job: JobRow,
  prefs: Prefs,
  feedback: ScoreBreakdown['feedback'] | undefined,
  now: Date,
): ScoreBreakdown {
  const { total: rule, dims, facts } = ruleScore(job, prefs, now)
  const llm = job.llmEval?.score ?? null
  const fb = feedback ?? { total: 0, items: [] }
  return {
    final: (llm ?? rule) + fb.total,
    llm,
    rule,
    ruleDims: dims,
    usedFallback: llm === null,
    feedback: fb,
    ruleFacts: facts,
    llmReasons: job.llmEval?.reasons ?? [],
    llmHighlight: job.llmEval?.highlight ?? '',
  }
}

/** 近 60 天岗位（重评触发②用） */
export async function recentJobIds(days: number): Promise<string[]> {
  const rows = await db.execute<{ id: string }>(
    sql`SELECT id FROM jobs WHERE collected_at > now() - make_interval(days => ${days})`,
  )
  return rows.map((r) => r.id)
}
