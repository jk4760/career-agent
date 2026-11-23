import assert from 'node:assert/strict'
import { after, before, beforeEach, test } from 'node:test'
import { desc, eq, sql } from 'drizzle-orm'
import { migrate } from 'drizzle-orm/postgres-js/migrator'

const testUrl = new URL(process.env.DATABASE_URL!)
testUrl.pathname = '/nextcareer_m5_test'
process.env.DATABASE_URL = testUrl.toString()
process.env.MOONSHOT_API_KEY = 'fake-key'
process.env.MOONSHOT_MODEL = 'fake-report'
process.env.RESUME_STRATEGY_ENABLED = 'true'
process.env.RESUME_STRATEGY_FEISHU_PUSH_ENABLED = 'false'
process.env.FEISHU_ALERT_CHANNEL = 'webhook'
process.env.FEISHU_WEBHOOK_URL = ''
process.env.AI_BUDGET_ENFORCE = 'true'
for (const name of ['INPUT', 'OUTPUT', 'CACHE_HIT', 'CACHE_WRITE_5M', 'CACHE_WRITE_1H']) {
  process.env[`AI_PRICE_FAKE_REPORT_${name}_CNY_PER_MTOK`] = '1'
}

const { db, client } = await import('../db')
const schema = await import('../../../db/schema')
const { generateReport, reportSnapshots, reportState } = await import('./report')

const PREF_ID = '00000000-0000-4000-8000-00000000a501'
const JOB_A = '00000000-0000-4000-8000-00000000a502'
const JOB_B = '00000000-0000-4000-8000-00000000a503'
const MATERIAL_ID = '00000000-0000-4000-8000-00000000a504'

async function reset() {
  process.env.MOONSHOT_API_KEY = 'fake-key'
  await db.execute(sql`DROP TRIGGER IF EXISTS fail_report_running ON model_usage_requests`)
  await db.execute(sql`DROP FUNCTION IF EXISTS fail_report_running()`)
  await db.delete(schema.reportSourceSnapshots)
  await db.delete(schema.reportPushLog)
  await db.delete(schema.resumeStrategyReports)
  await db.delete(schema.resumeStrategySettings)
  await db.delete(schema.feedbackEvents)
  await db.delete(schema.jobs)
  await db.delete(schema.materials)
  await db.delete(schema.preferences)
  await db.delete(schema.modelUsageRequests)
  await db.delete(schema.modelBudgetDays)
  await db.delete(schema.modelBudgetAlerts)
  await db.insert(schema.preferences).values({
    id: PREF_ID, roles: ['产品经理'], locations: ['上海'], keywordsInclude: ['AI'],
    backgroundText: '虚构经历：负责一个虚构项目，指标提升 10%。', updatedAt: new Date(),
  })
  await db.insert(schema.jobs).values({
    id: JOB_A, title: '虚构 AI 产品经理', company: '虚构公司', location: '上海', source: 'fake',
    sourceUrl: 'https://example.com/a', description: '虚构岗位要求：负责 AI 产品规划。', dedupKey: 'fake-a',
  })
  await db.insert(schema.feedbackEvents).values({ jobId: JOB_A, action: 'interested' })
  await db.insert(schema.materials).values({
    id: MATERIAL_ID, project: '虚构项目', title: '虚构素材', content: '虚构素材正文', updatedAt: new Date(),
  })
}

before(async () => {
  await migrate(db, { migrationsFolder: '/app/api/drizzle' })
})
beforeEach(reset)
after(async () => {
  await reset()
  await client.end()
})

function fakeReport() {
  return {
    resume_count: 1,
    overview: '虚构报告概览',
    directions: [{
      name: '虚构方向', summary: '虚构摘要', key_capabilities: ['虚构能力一', '虚构能力二'],
      priority_experiences: [], evidence: [{ text: '指标提升 10%', source_type: 'resume', source_id: PREF_ID }], gaps: [],
    }],
    source_summary: { interested_job_count: 1, resume_id: PREF_ID, resume_name: '当前简历（个人背景）', material_ids: [], material_count: 0 },
  }
}

function upstream(report: unknown, finishReason = 'stop') {
  return new Response(JSON.stringify({
    choices: [{ message: { content: JSON.stringify(report) }, finish_reason: finishReason }],
    usage: { prompt_tokens: 100, completion_tokens: 50 },
  }), { status: 200, headers: { 'Content-Type': 'application/json' } })
}

async function waitFor(reportId: string, status: string) {
  for (let index = 0; index < 100; index++) {
    const [row] = await db.select().from(schema.resumeStrategyReports).where(eq(schema.resumeStrategyReports.id, reportId))
    if (row.status === status) return row
    await new Promise((resolve) => setTimeout(resolve, 20))
  }
  throw new Error('报告任务未按预期结束')
}

test('首次生成使用一次严格 fake upstream，no_change 零调用', async () => {
  let calls = 0
  globalThis.fetch = async (_input, init) => {
    calls += 1
    const body = JSON.parse(String(init?.body))
    assert.equal(body.reasoning_effort, 'low')
    assert.equal(body.max_completion_tokens, 4000)
    assert.equal(body.response_format.json_schema.strict, true)
    return upstream(fakeReport())
  }
  const created = await generateReport()
  assert.equal(created.noChange, false)
  const done = await waitFor(created.report.id, 'done')
  assert.equal((done.report as { directions: unknown[] }).directions.length, 1)
  assert.equal(calls, 1)
  const again = await generateReport()
  assert.equal(again.noChange, true, JSON.stringify({ before: created.report.inputHash, after: again.report.inputHash, status: again.report.status }))
  assert.equal(calls, 1)
})

test('撤销进入 removed；素材变化提示过时，历史快照保持原文', async () => {
  globalThis.fetch = async () => upstream(fakeReport())
  const created = await generateReport()
  await waitFor(created.report.id, 'done')
  await db.insert(schema.jobs).values({
    id: JOB_B, title: '虚构岗位 B', company: '虚构公司', source: 'fake', sourceUrl: 'https://example.com/b', description: '虚构要求 B', dedupKey: 'fake-b',
  })
  await db.insert(schema.feedbackEvents).values({ jobId: JOB_B, action: 'interested' })
  let state = await reportState()
  assert.deepEqual(state.diff.added_job_ids, [JOB_B])
  await db.update(schema.feedbackEvents).set({ canceledAt: new Date() }).where(eq(schema.feedbackEvents.jobId, JOB_B))
  state = await reportState()
  assert.equal(state.stale, false, JSON.stringify({ inputHash: state.inputHash, currentHash: state.current?.inputHash, diff: state.diff }))
  await db.update(schema.materials).set({ content: '虚构素材的新正文', updatedAt: new Date() }).where(eq(schema.materials.id, MATERIAL_ID))
  state = await reportState()
  assert.equal(state.stale, false)
  const history = await reportSnapshots(created.report.id)
  assert.equal(history?.snapshots.find((item) => item.sourceId === PREF_ID)?.content.includes('指标提升 10%'), true)
})

test('截断和 JSON 校验失败不覆盖上一份成功报告', async () => {
  globalThis.fetch = async () => upstream(fakeReport())
  const created = await generateReport()
  await waitFor(created.report.id, 'done')
  await db.insert(schema.jobs).values({
    id: JOB_B, title: '虚构岗位 B', company: '虚构公司', source: 'fake', sourceUrl: 'https://example.com/b', description: '虚构要求 B', dedupKey: 'fake-b',
  })
  await db.insert(schema.feedbackEvents).values({ jobId: JOB_B, action: 'interested' })
  globalThis.fetch = async () => upstream(fakeReport(), 'length')
  const truncated = await generateReport()
  const truncatedRow = await waitFor(truncated.report.id, 'truncated')
  assert.equal(truncatedRow.status, 'truncated')
  assert.equal((await reportState()).current.id, created.report.id)
  await db.update(schema.jobs).set({ description: '虚构岗位要求再次变化' }).where(eq(schema.jobs.id, JOB_B))
  globalThis.fetch = async () => upstream({ invalid: true })
  const failed = await generateReport()
  await waitFor(failed.report.id, 'error')
  assert.equal((await reportState()).current.id, created.report.id)
})

test('并发相同输入复用进行中任务，不重复调用', async () => {
  let calls = 0
  globalThis.fetch = async () => {
    calls += 1
    await new Promise((resolve) => setTimeout(resolve, 80))
    return upstream(fakeReport())
  }
  const [first, second] = await Promise.all([generateReport(), generateReport()])
  assert.equal(first.report.id, second.report.id)
  await waitFor(first.report.id, 'done')
  assert.equal(calls, 1)
})

test('取消会中断上游并保留上一份成功报告', async () => {
  globalThis.fetch = async () => upstream(fakeReport())
  const initial = await generateReport()
  await waitFor(initial.report.id, 'done')
  await db.insert(schema.jobs).values({
    id: JOB_B, title: '虚构岗位 B', company: '虚构公司', source: 'fake', sourceUrl: 'https://example.com/b', description: '虚构要求 B', dedupKey: 'fake-b',
  })
  await db.insert(schema.feedbackEvents).values({ jobId: JOB_B, action: 'interested' })
  globalThis.fetch = async (_input, init) => {
    if (init?.signal?.aborted) throw new Error('aborted')
    return new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new Error('aborted')))
    })
  }
  const running = await generateReport()
  const { cancelReport } = await import('./report')
  assert.equal(cancelReport(running.report.id), true)
  await waitFor(running.report.id, 'canceled')
  assert.equal((await reportState()).current.id, initial.report.id)
})

test('完整重建只调用一次 fake upstream 且不携带上一版报告', async () => {
  globalThis.fetch = async () => upstream(fakeReport())
  const initial = await generateReport()
  await waitFor(initial.report.id, 'done')
  globalThis.fetch = async (_input, init) => {
    const body = JSON.parse(String(init?.body))
    const prompt = JSON.parse(body.messages[1].content)
    assert.equal(prompt.previous_report, null)
    return upstream(fakeReport())
  }
  const rebuilt = await generateReport({ mode: 'rebuild' })
  const done = await waitFor(rebuilt.report.id, 'done')
  assert.equal(done.generationMode, 'rebuild')
  assert.equal(done.version, initial.report.version + 1)
})

test('生成期间修改依据，完成后立即显示依据已变化', async () => {
  globalThis.fetch = async () => upstream(fakeReport())
  const initial = await generateReport()
  await waitFor(initial.report.id, 'done')
  await db.insert(schema.jobs).values({
    id: JOB_B, title: '虚构岗位 B', company: '虚构公司', source: 'fake', sourceUrl: 'https://example.com/b', description: '虚构要求 B', dedupKey: 'fake-b',
  })
  await db.insert(schema.feedbackEvents).values({ jobId: JOB_B, action: 'interested' })
  globalThis.fetch = async () => {
    await new Promise((resolve) => setTimeout(resolve, 60))
    return upstream(fakeReport())
  }
  const running = await generateReport()
  await db.update(schema.preferences).set({ backgroundText: '虚构背景的新版本', updatedAt: new Date() })
  await waitFor(running.report.id, 'done')
  assert.equal((await reportState()).stale, true)
})

test('报告实际 Prompt 只使用任务创建时冻结的 A 输入', async () => {
  await db.update(schema.preferences).set({
    backgroundText: '虚构经历：负责一个虚构项目，指标提升 10%。\nRESUME_A_ONLY',
    updatedAt: new Date(),
  })
  await db.update(schema.jobs).set({ description: 'JOB_A_ONLY' }).where(eq(schema.jobs.id, JOB_A))
  await db.update(schema.materials).set({ content: 'MATERIAL_A_ONLY', updatedAt: new Date() }).where(eq(schema.materials.id, MATERIAL_ID))

  let releaseUpstream!: () => void
  const upstreamGate = new Promise<void>((resolve) => { releaseUpstream = resolve })
  let calls = 0
  let actualPrompt: { current_sources: { sourceId: string; content: string }[] }
  const responseReport = fakeReport()
  responseReport.directions[0].evidence.push({ text: 'RESUME_B_ONLY', source_type: 'resume', source_id: PREF_ID })
  globalThis.fetch = async (_input, init) => {
    calls += 1
    const body = JSON.parse(String(init?.body))
    actualPrompt = JSON.parse(body.messages[1].content)
    await upstreamGate
    return upstream(responseReport)
  }

  const created = await generateReport({ selection: {
    includePreferences: false, resumeId: PREF_ID, materialIds: [MATERIAL_ID], jobIds: [],
  } })
  await db.update(schema.preferences).set({ backgroundText: 'RESUME_B_ONLY', updatedAt: new Date() })
  await db.update(schema.jobs).set({ description: 'JOB_B_ONLY' }).where(eq(schema.jobs.id, JOB_A))
  await db.update(schema.materials).set({ content: 'MATERIAL_B_ONLY', updatedAt: new Date() }).where(eq(schema.materials.id, MATERIAL_ID))
  releaseUpstream()
  const done = await waitFor(created.report.id, 'done')

  const serializedPrompt = JSON.stringify(actualPrompt!)
  assert.ok(serializedPrompt.includes('RESUME_A_ONLY'))
  assert.ok(serializedPrompt.includes('JOB_A_ONLY'))
  assert.ok(serializedPrompt.includes('MATERIAL_A_ONLY'))
  assert.ok(!serializedPrompt.includes('RESUME_B_ONLY'))
  assert.ok(!serializedPrompt.includes('JOB_B_ONLY'))
  assert.ok(!serializedPrompt.includes('MATERIAL_B_ONLY'))
  assert.equal(done.inputHash, created.report.inputHash)
  const history = await reportSnapshots(created.report.id)
  const snapshotText = JSON.stringify(history?.snapshots)
  assert.ok(snapshotText.includes('RESUME_A_ONLY'))
  assert.ok(snapshotText.includes('JOB_A_ONLY'))
  assert.ok(snapshotText.includes('MATERIAL_A_ONLY'))
  assert.ok(!snapshotText.includes('_B_ONLY'))
  assert.equal((await reportState()).stale, true)
  const evidences = (done.report as ReturnType<typeof fakeReport>).directions[0].evidence
  assert.deepEqual(evidences.map((item) => item.text), ['指标提升 10%'])
  assert.equal(calls, 1)
})

test('新报告保存完整 JD 快照，Prompt 压缩与历史读取不依赖当前岗位', async () => {
  const { hashContent } = await import('./context')
  const endMarker = 'FICTIONAL_JD_END_AFTER_1200'
  const fullDescription = `${'虚'.repeat(1300)}${endMarker}`
  await db.update(schema.jobs).set({ description: fullDescription }).where(eq(schema.jobs.id, JOB_A))
  const [originalJob] = await db.select().from(schema.jobs).where(eq(schema.jobs.id, JOB_A))
  let calls = 0
  let promptJob: { content: string } | undefined
  globalThis.fetch = async (_input, init) => {
    calls += 1
    const body = JSON.parse(String(init?.body))
    const prompt = JSON.parse(body.messages[1].content)
    promptJob = prompt.current_sources.find((source: { sourceId: string }) => source.sourceId === JOB_A)
    return upstream(fakeReport())
  }

  const created = await generateReport()
  await waitFor(created.report.id, 'done')
  const history = await reportSnapshots(created.report.id)
  const snapshot = history?.snapshots.find((item) => item.sourceId === JOB_A)
  assert.ok(snapshot)
  assert.ok(snapshot.content.endsWith(endMarker))
  assert.equal(snapshot.sourceId, JOB_A)
  assert.equal(snapshot.version, originalJob.collectedAt.toISOString())
  assert.equal(snapshot.hash, hashContent(snapshot.content))
  assert.ok(promptJob)
  assert.ok(promptJob.content.length < snapshot.content.length)
  assert.ok(!promptJob.content.includes(endMarker))
  assert.ok(promptJob.content.includes('虚'))

  await db.update(schema.jobs).set({ description: 'CURRENT_JOB_B_ONLY' }).where(eq(schema.jobs.id, JOB_A))
  const historicalAfterEdit = await reportSnapshots(created.report.id)
  const unchanged = historicalAfterEdit?.snapshots.find((item) => item.sourceId === JOB_A)
  assert.equal(unchanged?.content, snapshot.content)
  assert.equal(unchanged?.hash, snapshot.hash)
  assert.equal((await reportState()).stale, true)
  assert.equal(calls, 1)
})


test('报告 Key 缺失未发请求，不预留也不增加已结算金额', async () => {
  const { getBudgetStatus } = await import('./budget')
  delete process.env.MOONSHOT_API_KEY
  let calls = 0
  globalThis.fetch = async () => {
    calls += 1
    throw new Error('不应调用上游')
  }
  const created = await generateReport()
  const failed = await waitFor(created.report.id, 'error')
  assert.equal(failed.errorCode, 'MODEL_NOT_CONFIGURED')
  assert.equal(calls, 0)
  const rows = await db.select().from(schema.modelUsageRequests)
  assert.equal(rows.length, 0)
  const status = await getBudgetStatus()
  assert.equal(status.spentCny, '0.000000')
  assert.equal(status.reservedCny, '0.000000')
})

test('报告预留后请求前本地失败，完全释放且仅有一个终态台账', async () => {
  const { getBudgetStatus } = await import('./budget')
  await db.execute(sql`
    CREATE OR REPLACE FUNCTION fail_report_running() RETURNS trigger AS $trigger$
    BEGIN
      IF NEW.status = 'running' AND NEW.purpose = 'resume_strategy' THEN
        RAISE EXCEPTION 'REPORT_NOT_SENT_TEST';
      END IF;
      RETURN NEW;
    END;
    $trigger$ LANGUAGE plpgsql
  `)
  await db.execute(sql`
    CREATE TRIGGER fail_report_running BEFORE UPDATE OF status ON model_usage_requests
    FOR EACH ROW EXECUTE FUNCTION fail_report_running()
  `)
  try {
    let calls = 0
    globalThis.fetch = async () => {
      calls += 1
      throw new Error('不应调用上游')
    }
    const created = await generateReport()
    const failed = await waitFor(created.report.id, 'error')
    assert.ok(failed.errorCode?.includes('update "model_usage_requests"'))
    assert.equal(calls, 0)
    const rows = await db.select().from(schema.modelUsageRequests)
    assert.equal(rows.length, 1)
    assert.equal(rows[0].status, 'failed')
    assert.equal(rows[0].actualAmount, '0.000000')
    assert.equal(rows[0].errorCode, 'NOT_SENT')
    const status = await getBudgetStatus()
    assert.equal(status.spentCny, '0.000000')
    assert.equal(status.reservedCny, '0.000000')
  } finally {
    await db.execute(sql`DROP TRIGGER IF EXISTS fail_report_running ON model_usage_requests`)
    await db.execute(sql`DROP FUNCTION IF EXISTS fail_report_running()`)
  }
})

for (const failure of [
  { name: '网络错误', respond: async () => { throw new TypeError('fake report network failure') } },
  { name: 'HTTP 500', respond: async () => new Response('{"error":"fake"}', { status: 500 }) },
]) {
  test(`报告已尝试上游后发生${failure.name}，仅保守结算一次`, async () => {
    const { getBudgetStatus } = await import('./budget')
    let calls = 0
    globalThis.fetch = async () => {
      calls += 1
      return failure.respond()
    }
    const created = await generateReport()
    await waitFor(created.report.id, 'error')
    assert.equal(calls, 1)
    const rows = await db.select().from(schema.modelUsageRequests)
    assert.equal(rows.length, 1)
    assert.equal(rows[0].status, 'conservative')
    assert.equal(rows[0].actualAmount, rows[0].reservedAmount)
    const status = await getBudgetStatus()
    assert.equal(status.spentCny, rows[0].reservedAmount)
    assert.equal(status.reservedCny, '0.000000')
  })
}

test('报告成功按真实 usage 结算一次并释放多余预留', async () => {
  const { getBudgetStatus } = await import('./budget')
  globalThis.fetch = async () => upstream(fakeReport())
  const created = await generateReport()
  await waitFor(created.report.id, 'done')
  const rows = await db.select().from(schema.modelUsageRequests)
  assert.equal(rows.length, 1)
  assert.equal(rows[0].status, 'completed')
  assert.equal(rows[0].actualAmount, '0.000150')
  assert.ok(Number(rows[0].actualAmount) < Number(rows[0].reservedAmount))
  const status = await getBudgetStatus()
  assert.equal(status.spentCny, rows[0].actualAmount)
  assert.equal(status.reservedCny, '0.000000')
})
