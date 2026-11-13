// M4 施工项 3：LLM 评分 prompt（版本化入 git；升级 PROMPT_VERSION 触发全量重评）
// 锚定评分标准 + 校准示例压抖动；temperature 0 + 结构化 JSON 输出

export const PROMPT_VERSION = 'v1.1'

export function systemPrompt(): string {
  return `你是求职匹配评分助手。根据候选人的个人背景与求职偏好，评估岗位与候选人的匹配度，输出 0–100 分。

评分锚定标准：
- 90–100：职能高度对口，候选人的核心经历可直接复用，方向/地点完全契合
- 70–89：职能对口，经历大部分可迁移，存在少量不匹配点
- 50–69：部分相关，需要明显转型，或关键信息不足
- 30–49：边缘相关，只有间接经验可用
- 0–29：明显不相关

评分只看岗位与候选人的匹配事实，不因公司规模、知名度加减分。

输出严格 JSON，不要输出任何其他内容：
{
  "score": <0-100 整数>,
  "reasons": [<最多 2 个标签，每个不超过 12 字，说明最关键的匹配或不匹配点>],
  "highlight": "<一句话，不超过 30 字：这个岗位是做什么的 + 为什么值得（或不值得）候选人看>"
}

校准示例：
- 候选人背景为「数据分析转 AI 产品」时，岗位「AI Agent 产品经理（大厂，上海）」→ {"score": 92, "reasons": ["AI 产品方向对口", "数据分析经验可复用"], "highlight": "负责 AI Agent 产品从 0 到 1，与候选人的 Agent 项目经历直接对口"}
- 同一候选人，岗位「Java 后端开发工程师」→ {"score": 25, "reasons": ["纯开发岗不对口"], "highlight": "后端开发岗，与候选人的产品/分析方向不匹配"}
- 同一候选人，岗位「金融业务数据运营专员」→ {"score": 58, "reasons": ["数据相关但偏运营执行"], "highlight": "金融数据运营执行岗，数据相关但缺少产品决策空间"}`
}

export interface ScoreJobInput {
  title: string
  company: string
  location: string | null
  salaryMin: number | null
  salaryMax: number | null
  description: string | null
}

export interface ScorePrefsInput {
  roles: string[]
  locations: string[]
  salaryMin: number | null
  keywordsInclude: string[]
  keywordsExclude: string[]
  experienceMin: number | null
  backgroundText: string | null
}

const JD_MAX_CHARS = 4000 // ~2000 token，控制单次调用成本

export function userPrompt(job: ScoreJobInput, prefs: ScorePrefsInput): string {
  const jd = (job.description || '').slice(0, JD_MAX_CHARS)
  const salary =
    job.salaryMin && job.salaryMax
      ? `${job.salaryMin / 1000}k–${job.salaryMax / 1000}k`
      : '面议/未知'
  return `【候选人个人背景】
${prefs.backgroundText || '（未填写）'}

【求职偏好】
目标职能：${prefs.roles.join('、') || '未设置'}
关键词（喜）：${prefs.keywordsInclude.join('、') || '无'}
关键词（拒）：${prefs.keywordsExclude.join('、') || '无'}
目标城市：${prefs.locations.join('、') || '不限'}
期望月薪下限：${prefs.salaryMin ? prefs.salaryMin / 1000 + 'k' : '未设置'}
经验年限上限：${prefs.experienceMin ?? '不限'}

【岗位】
标题：${job.title}
公司：${job.company}
地点：${job.location || '未知'}
薪资：${salary}
JD：
${jd || '（无 JD 正文）'}`
}
