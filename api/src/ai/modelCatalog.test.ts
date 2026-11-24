import assert from 'node:assert/strict'
import { after, beforeEach, test } from 'node:test'
import { eq } from 'drizzle-orm'
import { Hono } from 'hono'

const testUrl = new URL(process.env.DATABASE_URL!)
testUrl.pathname = '/nextcareer_m5_test'
process.env.DATABASE_URL = testUrl.toString()

const { db, client } = await import('../db')
const schema = await import('../../../db/schema')
const { createChatStream, createConversation, historyForRequest } = await import('./chat')
const { aiRoute } = await import('../routes/ai')
const { getBudgetStatus } = await import('./budget')

const EMPTY_SELECTION = { includePreferences: false, resumeId: null, materialIds: [], jobIds: [] }

function configureCatalog() {
  process.env.MOONSHOT_API_KEY = 'fake-key'
  process.env.MOONSHOT_MODEL = 'fake-chat'
  process.env.AI_CHAT_ENABLED = 'true'
  process.env.AI_BUDGET_ENFORCE = 'true'
  process.env.FAKE_OTHER_API_KEY = 'fake-other-key'
  process.env.AI_CHAT_MODEL_CATALOG_JSON = JSON.stringify([{
    id: 'fake-other',
    label: '虚构备选模型',
    provider: 'fake-provider',
    model: 'fake-other',
    baseUrl: 'https://example.com/other/v1',
    apiKeyEnv: 'FAKE_OTHER_API_KEY',
    enabled: true,
    maxCompletionTokens: 1500,
    capabilities: { streaming: true, usage: true, reasoning: false, jsonSchema: false },
  }])
  for (const name of ['INPUT', 'OUTPUT', 'CACHE_HIT', 'CACHE_WRITE_5M', 'CACHE_WRITE_1H']) {
    process.env[`AI_PRICE_FAKE_CHAT_${name}_CNY_PER_MTOK`] = '1'
    process.env[`AI_PRICE_FAKE_OTHER_${name}_CNY_PER_MTOK`] = '2'
  }
}

beforeEach(async () => {
  configureCatalog()
  await db.delete(schema.messages)
  await db.delete(schema.conversations)
  await db.delete(schema.modelUsageRequests)
  await db.delete(schema.modelBudgetDays)
})

after(async () => {
  await db.delete(schema.messages)
  await db.delete(schema.conversations)
  await db.delete(schema.modelUsageRequests)
  await db.delete(schema.modelBudgetDays)
  await client.end()
})

async function consume(stream: ReadableStream<Uint8Array>) {
  const reader = stream.getReader()
  const decoder = new TextDecoder()
  let text = ''
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    text += decoder.decode(value, { stream: true })
  }
  return text
}

function fakeSse() {
  return new Response([
    { choices: [{ delta: { content: '虚构回答' } }] },
    { choices: [{ delta: { content: '完成', finish_reason: 'stop' } }] },
    { choices: [], usage: { prompt_tokens: 20, completion_tokens: 5 } },
  ].map((chunk) => `data: ${JSON.stringify(chunk)}\n\n`).join('') + 'data: [DONE]\n\n', {
    status: 200,
    headers: { 'Content-Type': 'text/event-stream' },
  })
}

test('默认与备选创建使用服务端目录，伪造 model/base URL 不生效且目录不泄露配置', async () => {
  const defaultConversation = await createConversation()
  assert.equal(defaultConversation.model, 'fake-chat')
  const other = await createConversation('fake-other')
  assert.equal(other.provider, 'fake-provider')
  assert.equal(other.model, 'fake-other')
  assert.equal(process.env.MOONSHOT_MODEL, 'fake-chat')

  const app = new Hono().route('/api/ai', aiRoute)
  const created = await app.request('/api/ai/conversations', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ catalogId: 'fake-other', model: 'forged-model', baseUrl: 'https://forged.example' }),
  })
  assert.equal(created.status, 201)
  assert.equal((await created.json()).model, 'fake-other')
  const config = await app.request('/api/ai/config')
  const text = await config.text()
  assert.ok(!text.includes('fake-other-key'))
  assert.ok(!text.includes('FAKE_OTHER_API_KEY'))
  const body = JSON.parse(text)
  assert.equal(body.catalog.length, 2)
  assert.equal(body.catalog[0].is_default, true)
  for (const item of body.catalog) {
    assert.equal('baseUrl' in item, false)
    assert.equal('apiKeyEnv' in item, false)
  }
})

test('白名单外、未配置、禁用、价格缺失与能力不支持均不能创建', async () => {
  await assert.rejects(createConversation('not-in-catalog'), /MODEL_NOT_AVAILABLE/)
  process.env.FAKE_OTHER_API_KEY = ''
  await assert.rejects(createConversation('fake-other'), /MODEL_NOT_CONFIGURED/)
  process.env.FAKE_OTHER_API_KEY = 'fake-other-key'
  delete process.env.AI_PRICE_FAKE_OTHER_OUTPUT_CNY_PER_MTOK
  await assert.rejects(createConversation('fake-other'), /MODEL_PRICE_MISSING/)
  configureCatalog()
  const catalog = JSON.parse(process.env.AI_CHAT_MODEL_CATALOG_JSON!)
  catalog[0].enabled = false
  process.env.AI_CHAT_MODEL_CATALOG_JSON = JSON.stringify(catalog)
  await assert.rejects(createConversation('fake-other'), /MODEL_DISABLED/)
  catalog[0].enabled = true
  catalog[0].capabilities.streaming = false
  process.env.AI_CHAT_MODEL_CATALOG_JSON = JSON.stringify(catalog)
  await assert.rejects(createConversation('fake-other'), /MODEL_CAPABILITY_UNSUPPORTED/)
  assert.equal((await db.select().from(schema.conversations)).length, 0)
})

test('会话固定模型、能力参数、独立价格与共享预算，历史不跨会话回放', async () => {
  const other = await createConversation('fake-other')
  const bodies: Record<string, unknown>[] = []
  globalThis.fetch = async (input, init) => {
    bodies.push({ url: String(input), ...JSON.parse(String(init?.body)) })
    return fakeSse()
  }
  const first = await createChatStream({
    conversationId: other.id,
    content: '虚构问题',
    clientRequestId: 'catalog-other-stream',
    contextSelection: EMPTY_SELECTION,
  })
  await consume(first.stream!)
  assert.equal(bodies[0].model, 'fake-other')
  assert.equal(bodies[0].url, 'https://example.com/other/v1/chat/completions')
  assert.equal(bodies[0].max_completion_tokens, 1500)
  assert.equal('reasoning_effort' in bodies[0], false)

  const fresh = await createConversation()
  assert.equal(fresh.model, 'fake-chat')
  assert.deepEqual(await historyForRequest(fresh.id), [])
  const second = await createChatStream({
    conversationId: fresh.id,
    content: '默认模型问题',
    clientRequestId: 'catalog-default-stream',
    contextSelection: EMPTY_SELECTION,
  })
  await consume(second.stream!)
  assert.equal(bodies[1].model, 'fake-chat')
  assert.equal(bodies[1].reasoning_effort, 'low')
  assert.equal(bodies[1].max_completion_tokens, 2000)
  const usage = await db.select().from(schema.modelUsageRequests)
  assert.equal(usage.length, 2)
  assert.equal(usage.find((row) => row.model === 'fake-other')?.actualAmount, '0.000050')
  assert.equal(usage.find((row) => row.model === 'fake-chat')?.actualAmount, '0.000025')
  assert.equal((await getBudgetStatus()).totalCny, '0.000075')
  assert.equal(process.env.MOONSHOT_MODEL, 'fake-chat')
})

test('备选模型失败不自动换模或重试', async () => {
  const other = await createConversation('fake-other')
  let calls = 0
  globalThis.fetch = async (_input, init) => {
    calls += 1
    assert.equal(JSON.parse(String(init?.body)).model, 'fake-other')
    return new Response('fake failure', { status: 401 })
  }
  const result = await createChatStream({
    conversationId: other.id,
    content: '失败测试',
    clientRequestId: 'catalog-other-failure',
    contextSelection: EMPTY_SELECTION,
  })
  await consume(result.stream!)
  assert.equal(calls, 1)
  const [conversation] = await db.select().from(schema.conversations).where(eq(schema.conversations.id, other.id))
  assert.equal(conversation.model, 'fake-other')
  const [usage] = await db.select().from(schema.modelUsageRequests)
  assert.equal(usage.model, 'fake-other')
  assert.equal(usage.status, 'conservative')
})


test('修改全局默认配置后旧会话仍使用创建时模型', async () => {
  const original = await createConversation()
  assert.equal(original.model, 'fake-chat')
  process.env.MOONSHOT_MODEL = 'fake-other'
  globalThis.fetch = async (_input, init) => {
    const body = JSON.parse(String(init?.body))
    assert.equal(body.model, 'fake-chat')
    assert.equal(body.reasoning_effort, 'low')
    return fakeSse()
  }
  const result = await createChatStream({
    conversationId: original.id,
    content: '旧会话继续发送',
    clientRequestId: 'catalog-legacy-stream',
    contextSelection: EMPTY_SELECTION,
  })
  await consume(result.stream!)
  const [conversation] = await db.select().from(schema.conversations).where(eq(schema.conversations.id, original.id))
  assert.equal(conversation.model, 'fake-chat')
  const latest = await createConversation()
  assert.equal(latest.model, 'fake-other')
})
