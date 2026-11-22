import assert from 'node:assert/strict'
import { after, beforeEach, test } from 'node:test'
import { eq, inArray } from 'drizzle-orm'

process.env.DATABASE_URL ??= 'postgres://test:test@localhost:5432/test'
process.env.MOONSHOT_API_KEY = 'fake-key'
process.env.MOONSHOT_MODEL = 'fake-chat'
process.env.AI_BUDGET_ENFORCE = 'true'
for (const name of ['INPUT', 'OUTPUT', 'CACHE_HIT', 'CACHE_WRITE_5M', 'CACHE_WRITE_1H']) {
  process.env[`AI_PRICE_FAKE_CHAT_${name}_CNY_PER_MTOK`] = '1'
}

const { createChatStream, stopChat } = await import('./chat')
const { db, client } = await import('../db')
const { conversations, messages, modelUsageRequests } = await import('../../../db/schema')

const EMPTY_SELECTION = { includePreferences: false, resumeId: null, materialIds: [], jobIds: [] }

async function cleanup() {
  const testConversations = await db.select({ id: conversations.id }).from(conversations).where(eq(conversations.model, 'fake-chat'))
  if (testConversations.length) {
    await db.delete(messages).where(inArray(messages.conversationId, testConversations.map((item) => item.id)))
  }
  await db.delete(conversations).where(eq(conversations.model, 'fake-chat'))
  await db.delete(modelUsageRequests).where(eq(modelUsageRequests.model, 'fake-chat'))
}

beforeEach(cleanup)
after(async () => {
  await cleanup()
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

function fakeSseResponse(includeReasoning = true) {
  const chunks = [
    { choices: [{ delta: { reasoning_content: includeReasoning ? '内部推理' : undefined } }] },
    { choices: [{ delta: { content: '你好' } }] },
    { choices: [{ delta: { content: '，世界' }, finish_reason: 'stop' }] },
    { choices: [], usage: { prompt_tokens: 20, completion_tokens: 5 } },
  ]
  return new Response(chunks.map((chunk) => `data: ${JSON.stringify(chunk)}\n\n`).join('') + 'data: [DONE]\n\n', {
    status: 200,
    headers: { 'Content-Type': 'text/event-stream' },
  })
}

test('中文 SSE、上游参数、内部 assistant 回放与幂等', async () => {
  let calls = 0
  let replaySeen = false
  globalThis.fetch = async (_input, init) => {
    calls += 1
    const body = JSON.parse(String(init?.body))
    assert.equal(body.model, 'fake-chat')
    assert.equal(body.reasoning_effort, 'low')
    assert.equal(body.max_completion_tokens, 2000)
    assert.equal(body.stream, true)
    if (body.messages.some((message: { reasoning_content?: string }) => message.reasoning_content === '内部推理')) {
      replaySeen = true
    }
    return fakeSseResponse()
  }
  const first = await createChatStream({ content: '虚构问题', clientRequestId: 'm5-chat-test-1', contextSelection: EMPTY_SELECTION })
  assert.ok(first.stream)
  const output = await consume(first.stream)
  assert.ok(output.includes('你好'), output)
  assert.ok(output.includes('，世界'))
  assert.ok(!output.includes('内部推理'))
  const details = await db.select().from(messages).where(eq(messages.clientRequestId, 'm5-chat-test-1'))
  assert.equal(details[0].status, 'done')
  assert.equal(details[0].content, '你好，世界')

  const duplicate = await createChatStream({ content: '虚构问题', clientRequestId: 'm5-chat-test-1', contextSelection: EMPTY_SELECTION })
  assert.equal(duplicate.duplicate, true)
  assert.equal(calls, 1)

  await createConversationForReplay(first.conversationId)
  assert.equal(replaySeen, true)
  assert.equal(calls, 2)
})

async function createConversationForReplay(conversationId: string) {
  const result = await createChatStream({ conversationId, content: '下一轮', clientRequestId: 'm5-chat-test-replay', contextSelection: EMPTY_SELECTION })
  await consume(result.stream!)
}

test('停止会中断上游并保存 stopped 部分', async () => {
  let aborted = false
  globalThis.fetch = async (_input, init) => {
    const signal = init?.signal
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('data: {"choices":[{"delta":{"content":"部分回答"}}]}\n\n'))
        signal?.addEventListener('abort', () => {
          aborted = true
          controller.error(new Error('aborted'))
        })
      },
    })
    return new Response(stream, { status: 200 })
  }
  const result = await createChatStream({ content: '停止测试', clientRequestId: 'm5-chat-test-stop', contextSelection: EMPTY_SELECTION })
  const outputPromise = consume(result.stream!)
  await new Promise((resolve) => setTimeout(resolve, 30))
  assert.equal(stopChat(result.assistantMessageId), true)
  const output = await outputPromise
  assert.ok(output.includes('部分回答'))
  const [row] = await db.select().from(messages).where(eq(messages.clientRequestId, 'm5-chat-test-stop'))
  assert.equal(row.status, 'stopped')
  assert.equal(row.content, '部分回答')
  assert.equal(aborted, true)
})

test('401、429、5xx 均不自动重试计费请求', async () => {
  let calls = 0
  let status = 401
  globalThis.fetch = async () => {
    calls += 1
    return new Response('fake error', { status })
  }
  for (const [index, nextStatus] of [401, 429, 500].entries()) {
    status = nextStatus
    const result = await createChatStream({ content: '错误测试', clientRequestId: `m5-chat-test-error-${index}`, contextSelection: EMPTY_SELECTION })
    await consume(result.stream!)
  }
  assert.equal(calls, 3)
})

test('历史消息只保留最近 6 轮', async () => {
  const { createConversation, historyForRequest } = await import('./chat')
  const conversation = await createConversation()
  const now = Date.now()
  await db.insert(messages).values(Array.from({ length: 14 }, (_, index) => ({
    conversationId: conversation.id,
    role: index % 2 === 0 ? 'user' : 'assistant',
    content: `虚构消息 ${index}`,
    status: 'done',
    createdAt: new Date(now + index * 1000),
  })))
  const history = await historyForRequest(conversation.id)
  assert.equal(history.length, 12)
  assert.equal(history[0].content, '虚构消息 2')
  assert.equal(history[11].content, '虚构消息 13')
})
