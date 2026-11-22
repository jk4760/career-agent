import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createCipheriv, createHash, randomBytes } from 'node:crypto'
import { Hono } from 'hono'

process.env.DATABASE_URL ??= 'postgres://test:test@localhost:5432/test'

const { buildReportSummaryCard } = await import('./reportCard')
const { feishuRoute } = await import('./callback')

const REPORT = {
  id: 'report-1', inputHash: 'hash-1', completedAt: new Date(),
  report: {
    resume_count: 1, overview: '虚构概览',
    directions: [{ name: '虚构方向', summary: '虚构摘要', key_capabilities: ['虚构能力一', '虚构能力二'], priority_experiences: [], evidence: [], gaps: [] }],
    source_summary: { interested_job_count: 1, resume_id: 'resume-1', resume_name: '虚构简历', material_ids: [], material_count: 0 },
  },
}

test('飞书摘要包含方向与依据提示，不包含原文或公网链接', () => {
  const card = buildReportSummaryCard(REPORT, { interestedCount: 1, stale: true })
  const text = JSON.stringify(card)
  assert.ok(text.includes('虚构方向'))
  assert.ok(text.includes('依据已变化'))
  assert.ok(!text.includes('http://49.235.68.206'))
  assert.ok(!text.includes('虚构概览'))
})

test('报告 action flag=false 不可见，开启后才显示', () => {
  process.env.RESUME_STRATEGY_FEISHU_ACTION_ENABLED = 'false'
  assert.ok(!JSON.stringify(buildReportSummaryCard(REPORT, { interestedCount: 1, stale: false })).includes('更新简历建议'))
  process.env.RESUME_STRATEGY_FEISHU_ACTION_ENABLED = 'true'
  assert.ok(JSON.stringify(buildReportSummaryCard(REPORT, { interestedCount: 1, stale: false })).includes('更新简历建议'))
})

test('明文和加密 Challenge 回归，伪造 token 403', async () => {
  process.env.FEISHU_APP_ID = 'fake-app'
  process.env.FEISHU_APP_SECRET = 'fake-secret'
  process.env.FEISHU_VERIFICATION_TOKEN = 'fake-token'
  process.env.FEISHU_ENCRYPT_KEY = 'fake-encrypt-key'
  const app = new Hono().route('/feishu', feishuRoute)
  const body = { token: 'fake-token', type: 'url_verification', challenge: 'fake-challenge' }
  const plain = await app.request('/feishu/callback', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  assert.equal(plain.status, 200)
  assert.equal((await plain.json()).challenge, 'fake-challenge')

  const key = createHash('sha256').update('fake-encrypt-key').digest()
  const iv = randomBytes(16)
  const cipher = createCipheriv('aes-256-cbc', key, iv)
  const encrypted = Buffer.concat([iv, cipher.update(JSON.stringify(body)), cipher.final()]).toString('base64')
  const encryptedResponse = await app.request('/feishu/callback', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ encrypt: encrypted }) })
  assert.equal(encryptedResponse.status, 200)

  const forged = await app.request('/feishu/callback', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...body, token: 'wrong' }) })
  assert.equal(forged.status, 403)
})
