import assert from 'node:assert/strict'
import { test } from 'node:test'
import { groupAllJobs } from '../src/lib/jobSorting'
import type { JobWithStatus } from '@/types'

function job(id: string, status: JobWithStatus['status'], score: number, collectedAt: string, postedAt: string | null = null): JobWithStatus {
  return {
    id,
    title: id,
    company: '虚构公司',
    location: null,
    salaryMin: null,
    salaryMax: null,
    currency: 'CNY',
    source: 'fake',
    sourceUrl: 'https://example.com',
    description: null,
    postedAt,
    collectedAt,
    dedupKey: id,
    llmEval: null,
    status,
    feedbackEvents: [],
    score: { final: score, llm: null, rule: score, ruleDims: { role: 0, salary: 0, company: 0, freshness: 0, experience: 0 }, usedFallback: true, feedback: { total: 0, items: [] }, ruleFacts: [], llmReasons: [], llmHighlight: '' },
  }
}

const items = [
  job('classified-high', 'interested', 99, '2026-11-01T00:00:00.000Z'),
  job('new-low', 'new', 20, '2026-11-03T00:00:00.000Z'),
  job('classified-pass', 'pass', 98, '2026-11-02T00:00:00.000Z'),
  job('new-high', 'new', 80, '2026-11-04T00:00:00.000Z'),
]

test('全部岗位保留所有状态，未分类在前，组内按匹配分', () => {
  const sorted = groupAllJobs(items, 'score')
  assert.deepEqual(sorted.map((item) => item.id), ['new-high', 'new-low', 'classified-high', 'classified-pass'])
})

test('全部岗位两组内分别按时间且顺序稳定', () => {
  const sorted = groupAllJobs(items, 'time')
  assert.deepEqual(sorted.map((item) => item.id), ['new-high', 'new-low', 'classified-pass', 'classified-high'])
  const tied = [job('b', 'new', 80, items[0].collectedAt), job('a', 'new', 80, items[0].collectedAt)]
  assert.deepEqual(groupAllJobs(tied, 'time').map((item) => item.id), ['a', 'b'])
})
