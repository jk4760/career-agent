import assert from 'node:assert/strict'
import { after, before, beforeEach, test } from 'node:test'
import { eq } from 'drizzle-orm'
import { migrate } from 'drizzle-orm/postgres-js/migrator'

const testUrl = new URL(process.env.DATABASE_URL!)
testUrl.pathname = '/nextcareer_m5_test'
process.env.DATABASE_URL = testUrl.toString()

const { db, client } = await import('../db')
const schema = await import('../../../db/schema')
const { saveAIMessage } = await import('./saveMessage')

const CONVERSATION_ID = '00000000-0000-4000-8000-00000000e501'
const MESSAGE_ID = '00000000-0000-4000-8000-00000000e502'

const MATERIAL_DATA = {
  project: '虚构项目',
  title: '用户确认的故事标题',
  facets: ['虚构方向'],
  capabilityL1: 'AI 产品',
  capabilityL2: 'Agent 评测',
  metrics: '用户确认的指标',
  content: '用户编辑后的素材正文',
}
const QUESTION_DATA = {
  category: '项目深挖',
  question: '用户确认的问题',
  answerDraft: '用户编辑后的回答草稿',
  linkedMaterialId: null,
}

before(async () => {
  await migrate(db, { migrationsFolder: '/app/api/drizzle' })
})

beforeEach(async () => {
  await db.delete(schema.aiMessageSaves)
  await db.delete(schema.messages).where(eq(schema.messages.conversationId, CONVERSATION_ID))
  await db.delete(schema.conversations).where(eq(schema.conversations.id, CONVERSATION_ID))
  await db.delete(schema.interviewQuestions)
  await db.delete(schema.materials)
  await db.insert(schema.conversations).values({
    id: CONVERSATION_ID,
    provider: 'fake-provider',
    model: 'fake-save-model',
    contextSelection: { includePreferences: false, resumeId: null, materialIds: [], jobIds: [] },
  })
  await db.insert(schema.messages).values({
    id: MESSAGE_ID,
    conversationId: CONVERSATION_ID,
    role: 'assistant',
    content: 'AI 原始回复',
    status: 'done',
    providerMessage: { role: 'assistant', content: 'AI 原始回复', reasoning_content: '内部推理不应泄露' },
    contextSnapshot: { private: '完整上下文不应泄露' },
  })
})

after(async () => {
  await db.delete(schema.aiMessageSaves)
  await db.delete(schema.messages).where(eq(schema.messages.conversationId, CONVERSATION_ID))
  await db.delete(schema.conversations).where(eq(schema.conversations.id, CONVERSATION_ID))
  await client.end()
})

test('done 回复分别保存素材和问答，用户编辑生效且保存零模型调用', async () => {
  let calls = 0
  globalThis.fetch = async () => {
    calls += 1
    throw new Error('保存不得调用模型')
  }
  const material = await saveAIMessage(MESSAGE_ID, { targetType: 'material', data: MATERIAL_DATA })
  const question = await saveAIMessage(MESSAGE_ID, { targetType: 'question', data: QUESTION_DATA })
  assert.equal(material.existing, false)
  assert.equal(question.existing, false)
  const [savedMaterial] = await db.select().from(schema.materials).where(eq(schema.materials.id, material.targetId))
  const [savedQuestion] = await db.select().from(schema.interviewQuestions).where(eq(schema.interviewQuestions.id, question.targetId))
  assert.equal(savedMaterial.content, MATERIAL_DATA.content)
  assert.equal(savedMaterial.title, MATERIAL_DATA.title)
  assert.equal(savedQuestion.answerDraft, QUESTION_DATA.answerDraft)
  assert.notEqual(savedMaterial.content, 'AI 原始回复')
  for (const saved of [material, question]) {
    assert.equal(saved.source.sourceType, 'ai_message')
    assert.equal(saved.source.conversationId, CONVERSATION_ID)
    assert.equal(saved.source.messageId, MESSAGE_ID)
    assert.equal(saved.source.provider, 'fake-provider')
    assert.equal(saved.source.model, 'fake-save-model')
    assert.equal(saved.source.targetId, saved.targetId)
    const serialized = JSON.stringify(saved.source)
    assert.ok(!serialized.includes('内部推理'))
    assert.ok(!serialized.includes('完整上下文'))
  }
  const [original] = await db.select().from(schema.messages).where(eq(schema.messages.id, MESSAGE_ID))
  assert.equal(original.content, 'AI 原始回复')
  assert.equal(original.status, 'done')
  assert.equal(calls, 0)
})

test('同一消息同目标持久化去重，并允许两类目标各一条', async () => {
  const first = await saveAIMessage(MESSAGE_ID, { targetType: 'material', data: MATERIAL_DATA })
  const repeated = await saveAIMessage(MESSAGE_ID, {
    targetType: 'material',
    data: { ...MATERIAL_DATA, title: '重复点击不应覆盖' },
  })
  assert.equal(repeated.existing, true)
  assert.equal(repeated.targetId, first.targetId)
  await saveAIMessage(MESSAGE_ID, { targetType: 'question', data: QUESTION_DATA })
  assert.equal((await db.select().from(schema.materials)).length, 1)
  assert.equal((await db.select().from(schema.interviewQuestions)).length, 1)
  assert.equal((await db.select().from(schema.aiMessageSaves)).length, 2)
  const [unchanged] = await db.select().from(schema.materials)
  assert.equal(unchanged.title, MATERIAL_DATA.title)
})

test('并发重复保存由唯一约束回滚多余目标', async () => {
  const results = await Promise.all([
    saveAIMessage(MESSAGE_ID, { targetType: 'material', data: MATERIAL_DATA }),
    saveAIMessage(MESSAGE_ID, { targetType: 'material', data: MATERIAL_DATA }),
  ])
  assert.equal(results[0].targetId, results[1].targetId)
  assert.equal((await db.select().from(schema.materials)).length, 1)
  assert.equal((await db.select().from(schema.aiMessageSaves)).length, 1)
})

test('非 done、空正文、非 assistant 和非法输入均不能保存', async () => {
  for (const status of ['streaming', 'stopped', 'error', 'truncated']) {
    await db.update(schema.messages).set({ status }).where(eq(schema.messages.id, MESSAGE_ID))
    await assert.rejects(saveAIMessage(MESSAGE_ID, { targetType: 'material', data: MATERIAL_DATA }), /AI_MESSAGE_NOT_SAVEABLE/)
  }
  await db.update(schema.messages).set({ status: 'done', content: '' }).where(eq(schema.messages.id, MESSAGE_ID))
  await assert.rejects(saveAIMessage(MESSAGE_ID, { targetType: 'material', data: MATERIAL_DATA }), /AI_MESSAGE_NOT_SAVEABLE/)
  await db.update(schema.messages).set({ role: 'user', content: '非空' }).where(eq(schema.messages.id, MESSAGE_ID))
  await assert.rejects(saveAIMessage(MESSAGE_ID, { targetType: 'material', data: MATERIAL_DATA }), /AI_MESSAGE_NOT_SAVEABLE/)
  await assert.rejects(saveAIMessage('00000000-0000-4000-8000-00000000e599', { targetType: 'material', data: MATERIAL_DATA }), /AI_MESSAGE_NOT_FOUND/)
  await assert.rejects(saveAIMessage(MESSAGE_ID, { targetType: 'material', data: { ...MATERIAL_DATA, project: '' } }), /SAVE_INPUT_INVALID/)
  assert.equal((await db.select().from(schema.materials)).length, 0)
  assert.equal((await db.select().from(schema.aiMessageSaves)).length, 0)
})

test('事务失败不留下问题目标或来源记录', async () => {
  await assert.rejects(saveAIMessage(MESSAGE_ID, {
    targetType: 'question',
    data: { ...QUESTION_DATA, linkedMaterialId: '00000000-0000-4000-8000-00000000e598' },
  }))
  assert.equal((await db.select().from(schema.interviewQuestions)).length, 0)
  assert.equal((await db.select().from(schema.aiMessageSaves)).length, 0)
})
