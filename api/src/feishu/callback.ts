// M4.5 施工项 2：飞书回调路由 POST /feishu/callback
// 流程（设计稿 §4.2）：解密（可选）→ Verification Token 校验（不匹配 403）→
// url_verification 回显 → card.action.trigger 按 stage 处理并同步返回新卡片
import { Hono } from 'hono'
import { addFeedback, cancelFeedback, CARD_REASON_TO_ENUM, type FeedbackAction } from '../feedback'
import { loadPrefs } from '../routes/internal'
import {
  assembleEntries,
  buildPushCard,
  cardUpdateResponse,
  toastResponse,
} from './card'
import { decryptEvent, extractEventType, extractToken } from './crypto'
import { feishuAppConfigured } from './token'

type Json = Record<string, unknown>

const log = (msg: string, ...args: unknown[]) => console.log(`[feishu-callback] ${msg}`, ...args)

/** 从回调体里抠 action.value（兼容新旧两版事件结构） */
function extractActionValue(body: Json): Json | null {
  const event = body.event as Json | undefined
  const action = (event?.action ?? body.action) as Json | undefined
  const value = action?.value as Json | undefined
  return value ?? null
}

async function rebuildCardResponse(cardJobs: string[], opts?: { askReasonJobId?: string }) {
  const prefs = await loadPrefs()
  const entries = await assembleEntries(cardJobs, prefs, opts)
  return cardUpdateResponse(buildPushCard(entries, cardJobs))
}

export const feishuRoute = new Hono().post('/callback', async (c) => {
  // 降级行为（施工项 0）：半配置状态不静默——未配齐直接 503
  if (!feishuAppConfigured()) {
    return c.json({ error: 'feishu app not configured (FEISHU_APP_ID/SECRET/VERIFICATION_TOKEN)' }, 503)
  }

  let body = (await c.req.json().catch(() => null)) as Json | null
  if (!body) return c.json({ error: 'invalid json' }, 400)

  // 解密（配了 Encrypt Key 则强制要求加密体）
  const encryptKey = process.env.FEISHU_ENCRYPT_KEY
  if (encryptKey) {
    const enc = body.encrypt
    if (typeof enc !== 'string') return c.json({ error: 'expected encrypted body' }, 400)
    body = decryptEvent(encryptKey, enc)
    if (!body) return c.json({ error: 'decrypt failed' }, 400)
  }

  // Verification Token 校验（公网暴露面的唯一防线，不匹配一律 403）
  if (extractToken(body) !== process.env.FEISHU_VERIFICATION_TOKEN) {
    log('token 校验失败（403）')
    return c.json({ error: 'forbidden' }, 403)
  }

  // url_verification：配置回调 URL 时的验证
  const eventType = extractEventType(body)
  if (body.type === 'url_verification' || eventType === 'url_verification') {
    log('url_verification 通过')
    return c.json({ challenge: body.challenge })
  }

  if (eventType !== 'card.action.trigger') {
    return c.json({ ok: true }) // 其他事件忽略
  }

  const value = extractActionValue(body)
  const jobId = typeof value?.jobId === 'string' ? value.jobId : null
  const stage = typeof value?.stage === 'string' ? value.stage : null
  const cardJobs = Array.isArray(value?.cardJobs)
    ? (value.cardJobs as unknown[]).filter((x): x is string => typeof x === 'string')
    : []
  log('card.action.trigger stage=%s jobId=%s', stage, jobId)

  if (!value || !jobId || !stage || !cardJobs.length) {
    return c.json(toastResponse('error', '卡片数据不完整，请重试'))
  }

  try {
    // 态①→态②：点「不合适」原地换成原因选择（不落库）
    if (stage === 'ask_reason') {
      log('结果：渲染原因选择（ask_reason）')
      return c.json(await rebuildCardResponse(cardJobs, { askReasonJobId: jobId }))
    }

    // 提交：按 action 落库（复用 Web 反馈同一服务函数）
    if (stage === 'submit') {
      const action = value.action as FeedbackAction | undefined
      if (!action || !['interested', 'pass', 'applied'].includes(action)) {
        return c.json(toastResponse('error', '未知动作'))
      }
      let reason: string | undefined
      if (action === 'pass') {
        const label = typeof value.reason === 'string' ? value.reason : ''
        reason = CARD_REASON_TO_ENUM[label]
        if (!reason) return c.json(toastResponse('error', '请选择不合适的原因'))
      }
      const result = await addFeedback(jobId, action, reason)
      if (!result.ok) {
        log('结果：落库失败 %s', result.error)
        return c.json(toastResponse('error', result.error ?? '提交失败'))
      }
      log('结果：已落库 action=%s reason=%s', action, reason ?? '-')
      return c.json(await rebuildCardResponse(cardJobs))
    }

    // 撤销：10 分钟窗口校验，给该次事件打 canceled_at
    if (stage === 'undo') {
      const eventId = typeof value.eventId === 'string' ? value.eventId : ''
      if (!eventId) return c.json(toastResponse('error', '撤销参数缺失'))
      const result = await cancelFeedback(eventId)
      if (!result.ok) {
        log('结果：撤销被拒 %s', result.error)
        return c.json(toastResponse('error', result.error ?? '撤销失败'))
      }
      log('结果：已撤销 event=%s', eventId)
      return c.json(await rebuildCardResponse(cardJobs))
    }

    return c.json({ ok: true }) // view 等其他 stage 忽略
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    log('处理异常：%s', msg)
    return c.json(toastResponse('error', '处理失败，请稍后再试'))
  }
})
