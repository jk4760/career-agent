import { Hono } from 'hono'
import { asc, desc, eq } from 'drizzle-orm'
import { conversations, messages } from '../../../db/schema'
import { db } from '../db'
import { getBudgetStatus } from '../ai/budget'
import { publicModelCatalog } from '../ai/modelCatalog'
import { saveAIMessage } from '../ai/saveMessage'
import {
  conversationDetails,
  createChatStream,
  createConversation,
  estimateConversationContext,
  stopChat,
  updateConversationContext,
} from '../ai/chat'

function chatEnabled(): boolean {
  return process.env.AI_CHAT_ENABLED?.trim().toLowerCase() === 'true'
}

export const aiRoute = new Hono()
  .get('/config', async (c) => {
    const model = process.env.MOONSHOT_MODEL || 'kimi-k3.1-pro'
    return c.json({
      provider: 'moonshot',
      baseUrl: process.env.MOONSHOT_BASE_URL || 'https://api.moonshot.cn/v1',
      model,
      models: [model],
      configured: Boolean(process.env.MOONSHOT_API_KEY),
      enabled: chatEnabled(),
      catalog: publicModelCatalog(),
      budget: await getBudgetStatus(),
    })
  })
  .get('/conversations', async (c) => {
    const rows = await db.select().from(conversations).orderBy(desc(conversations.updatedAt))
    const result = []
    for (const conversation of rows) {
      const history = await db
        .select({ content: messages.content })
        .from(messages)
        .where(eq(messages.conversationId, conversation.id))
        .orderBy(asc(messages.createdAt))
      const first = history[0]
      const last = history.at(-1)
      result.push({
        id: conversation.id,
        provider: conversation.provider,
        model: conversation.model,
        contextSelection: conversation.contextSelection,
        createdAt: conversation.createdAt,
        updatedAt: conversation.updatedAt,
        lastMessage: last?.content ?? null,
        messageCount: history.length,
        title: first?.content.slice(0, 24) || '新对话',
      })
    }
    return c.json(result)
  })
  .post('/conversations', async (c) => {
    if (!chatEnabled()) return c.json({ error: 'AI 对话功能未启用', code: 'FEATURE_DISABLED' }, 403)
    const body = await c.req.json().catch(() => ({}))
    const catalogId = typeof body.catalogId === 'string' ? body.catalogId : undefined
    try {
      return c.json(await createConversation(catalogId), 201)
    } catch (error) {
      const code = error instanceof Error ? error.message : 'MODEL_NOT_AVAILABLE'
      return c.json({ error: code }, 400)
    }
  })
  .get('/conversations/:id', async (c) => {
    const result = await conversationDetails(c.req.param('id'))
    return result ? c.json(result) : c.json({ error: '会话不存在' }, 404)
  })
  .put('/conversations/:id/context', async (c) => {
    const body = await c.req.json().catch(() => ({}))
    const result = await updateConversationContext(c.req.param('id'), body.selection)
    return result ? c.json(result) : c.json({ error: '会话不存在' }, 404)
  })
  .post('/context/estimate', async (c) => {
    const body = await c.req.json().catch(() => ({}))
    return c.json(await estimateConversationContext(body.selection))
  })
  .post('/chat/stream', async (c) => {
    if (!chatEnabled()) return c.json({ error: 'AI 对话功能未启用', code: 'FEATURE_DISABLED' }, 403)
    const body = await c.req.json().catch(() => null)
    if (!body) return c.json({ error: 'invalid json' }, 400)
    try {
      const result = await createChatStream(body, c.req.raw.signal)
      if (result.duplicate) {
        return c.json({
          duplicate: true,
          conversationId: result.conversationId,
          assistantMessageId: result.assistantMessageId,
          content: result.content,
          status: result.status,
        })
      }
      return new Response(result.stream, {
        headers: {
          'Content-Type': 'text/event-stream; charset=utf-8',
          'Cache-Control': 'no-cache, no-transform',
          Connection: 'keep-alive',
          'X-Accel-Buffering': 'no',
        },
      })
    } catch (error) {
      const code = error instanceof Error && 'code' in error ? String(error.code) : 'CHAT_ERROR'
      const message = error instanceof Error ? error.message : '对话请求失败'
      return c.json({ error: message, code }, 400)
    }
  })
  .post('/messages/:id/save', async (c) => {
    if (!chatEnabled()) return c.json({ error: 'AI 对话功能未启用', code: 'FEATURE_DISABLED' }, 403)
    const body = await c.req.json().catch(() => null)
    if (!body) return c.json({ error: 'invalid json' }, 400)
    try {
      const saved = await saveAIMessage(c.req.param('id'), body)
      return c.json(saved, saved.existing ? 200 : 201)
    } catch (error) {
      const code = error instanceof Error ? error.message : 'SAVE_ERROR'
      if (['SAVE_INPUT_INVALID', 'AI_MESSAGE_NOT_FOUND', 'AI_MESSAGE_NOT_SAVEABLE'].includes(code)) {
        return c.json({ error: code }, 400)
      }
      throw error
    }
  })
  .post('/messages/:id/stop', (c) => c.json({ stopped: stopChat(c.req.param('id')) }))
