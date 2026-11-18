// M4.5 施工项 1.4：自建应用发送函数（im/v1/messages；429/5xx 指数退避重试 ≤3）
import { getTenantAccessToken } from './token'

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

export interface SendResult {
  ok: boolean
  detail: string
  messageId?: string
}

async function postMessage(
  token: string,
  chatId: string,
  msgType: 'interactive' | 'text',
  content: unknown,
): Promise<SendResult> {
  const backoffMs = [0, 2000, 4000, 8000]
  let lastDetail = 'unknown'
  for (let attempt = 0; attempt < backoffMs.length; attempt++) {
    if (attempt > 0) await sleep(backoffMs[attempt])
    try {
      const resp = await fetch(
        'https://open.feishu.cn/open-apis/im/v1/messages?receive_id_type=chat_id',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({
            receive_id: chatId,
            msg_type: msgType,
            content: JSON.stringify(content),
          }),
          signal: AbortSignal.timeout(15_000),
        },
      )
      const data = (await resp.json()) as {
        code?: number
        msg?: string
        data?: { message_id?: string }
      }
      if (resp.ok && (data.code ?? 0) === 0) {
        return { ok: true, detail: 'ok', messageId: data.data?.message_id }
      }
      lastDetail = `HTTP ${resp.status} code=${data.code} msg=${data.msg}`
      if (resp.status === 429 || resp.status >= 500) continue // 可重试错误
      return { ok: false, detail: lastDetail } // 4xx（权限/参数类）不重试
    } catch (e) {
      lastDetail = e instanceof Error ? e.message : String(e)
    }
  }
  return { ok: false, detail: lastDetail }
}

/** 发送交互卡片到目标群 */
export async function sendAppCard(chatId: string, card: Record<string, unknown>): Promise<SendResult> {
  const token = await getTenantAccessToken()
  if (!token) return { ok: false, detail: 'tenant_access_token 获取失败' }
  return postMessage(token, chatId, 'interactive', card)
}

/** 发送纯文本（⚠️ 告警通道 = app 时用） */
export async function sendAppText(chatId: string, text: string): Promise<SendResult> {
  const token = await getTenantAccessToken()
  if (!token) return { ok: false, detail: 'tenant_access_token 获取失败' }
  return postMessage(token, chatId, 'text', { text })
}

/** 拉取机器人所在群列表（辅助用户取 chat_id；需 im:chat:readonly 权限） */
export async function listChats(): Promise<{ id: string; name: string }[] | null> {
  const token = await getTenantAccessToken()
  if (!token) return null
  try {
    const resp = await fetch('https://open.feishu.cn/open-apis/im/v1/chats', {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(15_000),
    })
    const data = (await resp.json()) as {
      code?: number
      data?: { items?: { chat_id: string; name: string }[] }
    }
    if ((data.code ?? -1) !== 0) return null
    return (data.data?.items ?? []).map((c) => ({ id: c.chat_id, name: c.name }))
  } catch {
    return null
  }
}
