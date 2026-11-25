import assert from 'node:assert/strict'
import { after, test } from 'node:test'
import type { JobRow, Prefs } from './scoring'

process.env.DATABASE_URL ??= 'postgres://test:test@localhost:5432/test'

const { buildScore, feedbackAdjustments } = await import('./scoring')
const { client } = await import('./db')

after(async () => {
  await client.end()
})

const NOW = new Date('2026-11-19T08:00:00.000Z')
const PREFS: Prefs = {
  roles: ['产品经理', '数据分析师'],
  locations: ['上海'],
  salaryMin: 20000,
  keywordsInclude: ['AI', 'Agent'],
  keywordsExclude: [],
  experienceMin: null,
  backgroundText: null,
}

function daysAgo(days: number): Date {
  return new Date(NOW.getTime() - days * 86400000)
}

function makeJob(id: string, title: string, llmScore: number | null = 90): JobRow {
  return {
    id,
    title,
    company: '测试公司',
    location: '上海',
    salaryMin: 30000,
    salaryMax: 50000,
    source: 'test',
    sourceUrl: '',
    description: '',
    postedAt: null,
    collectedAt: NOW,
    llmEval:
      llmScore === null
        ? null
        : {
            score: llmScore,
            reasons: [],
            prompt_version: 'test',
            scored_at: NOW.toISOString(),
          },
  }
}

function makeEvent(
  jobId: string,
  action: 'interested' | 'pass' | 'applied',
  createdAt: Date,
  canceledAt: Date | null = null,
  reason: string | null = null,
) {
  return { jobId, action, createdAt, canceledAt, reason }
}

const TARGET = makeJob('target', 'AI Agent 产品经理')
const SOURCE = makeJob('source', 'Agent 产品经理', 80)
const JOBS = [TARGET, SOURCE]

test('反馈满 60 天仍有效，超过 60 天失效', () => {
  const atBoundary = feedbackAdjustments(
    JOBS,
    [makeEvent('source', 'interested', daysAgo(60))],
    PREFS,
    NOW,
  ).get('target')
  const expired = feedbackAdjustments(
    JOBS,
    [makeEvent('source', 'interested', daysAgo(61))],
    PREFS,
    NOW,
  ).get('target')

  assert.equal(atBoundary?.total, 10)
  assert.equal(expired, undefined)
})

test('canceled_at 反馈被过滤，不参与调整', () => {
  const feedback = feedbackAdjustments(
    JOBS,
    [
      makeEvent('source', 'pass', daysAgo(1), daysAgo(0)),
      makeEvent('source', 'interested', daysAgo(2)),
    ],
    PREFS,
    NOW,
  ).get('target')

  assert.equal(feedback?.total, 10)
  assert.equal(feedback?.items.length, 1)
  assert.equal(feedback?.items[0].action, 'interested')
})

test('本岗位直接反馈不参与自身加减分，跨岗位关键词反馈仍按最新一条生效', () => {
  const feedback = feedbackAdjustments(
    JOBS,
    [
      makeEvent('target', 'pass', daysAgo(0)),
      makeEvent('source', 'interested', daysAgo(1)),
    ],
    PREFS,
    NOW,
  ).get('target')

  assert.equal(feedback?.total, 10)
  assert.equal(feedback?.items.length, 1)
})

test('多次反馈与多个命中关键词均不重复累加，最终分允许超过 100', () => {
  const target = makeJob('target', 'AI Agent 产品经理', 100)
  const events = [
    makeEvent('source', 'interested', daysAgo(1)),
    makeEvent('source', 'interested', daysAgo(2)),
    makeEvent('source', 'interested', daysAgo(3)),
  ]
  const feedback = feedbackAdjustments([target, SOURCE], events, PREFS, NOW).get('target')
  const score = buildScore(target, PREFS, feedback, NOW)

  assert.equal(feedback?.total, 10)
  assert.equal(feedback?.items.length, 1)
  assert.equal(score.final, 110)
})

test('已投递本身不产生加减分，也不覆盖较早的有效倾向反馈', () => {
  const appliedOnly = feedbackAdjustments(
    JOBS,
    [makeEvent('source', 'applied', daysAgo(0))],
    PREFS,
    NOW,
  ).get('target')
  const withEarlierInterest = feedbackAdjustments(
    JOBS,
    [
      makeEvent('source', 'applied', daysAgo(0)),
      makeEvent('source', 'interested', daysAgo(1)),
    ],
    PREFS,
    NOW,
  ).get('target')
  const score = buildScore(TARGET, PREFS, appliedOnly, NOW)

  assert.equal(appliedOnly, undefined)
  assert.equal(score.final, 90)
  assert.equal(withEarlierInterest?.total, 10)
})

test('最新反馈从感兴趣改为不合适后，岗位排序随之反转', () => {
  const target = makeJob('target', 'AI Agent 产品经理', 90)
  const competitor = makeJob('competitor', '视觉设计师', 85)
  const jobs = [target, competitor, SOURCE]
  const interested = feedbackAdjustments(
    jobs,
    [makeEvent('source', 'interested', daysAgo(1))],
    PREFS,
    NOW,
  )
  const passed = feedbackAdjustments(
    jobs,
    [makeEvent('source', 'pass', daysAgo(0))],
    PREFS,
    NOW,
  )
  const order = (feedback: typeof interested) =>
    [target, competitor]
      .map((job) => ({
        id: job.id,
        score: buildScore(job, PREFS, feedback.get(job.id), NOW).final,
      }))
      .sort((a, b) => b.score - a.score)
      .map((item) => item.id)

  assert.deepEqual(order(interested), ['target', 'competitor'])
  assert.deepEqual(order(passed), ['competitor', 'target'])
})


test('面试练习保持感兴趣但不触发相似岗位加权，其他感兴趣原因维持 +10', () => {
  const practice = feedbackAdjustments(
    JOBS,
    [makeEvent('source', 'interested', daysAgo(1), null, '面试练习')],
    PREFS,
    NOW,
  ).get('target')
  const company = feedbackAdjustments(
    JOBS,
    [makeEvent('source', 'interested', daysAgo(1), null, '公司想去')],
    PREFS,
    NOW,
  ).get('target')

  assert.equal(practice, undefined)
  assert.equal(company?.total, 10)
})
