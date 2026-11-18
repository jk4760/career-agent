// M4.5 施工项 1.2：回调解密（AES-256-CBC，飞书官方算法）+ Verification Token 校验
import { createDecipheriv, createHash } from 'node:crypto'

/**
 * 飞书事件订阅加密：body = {"encrypt": "<base64>"}。
 * 官方算法（以 OpenFeishu 测试向量验证）：key = SHA256(Encrypt Key)；
 * base64 解码后【前 16 字节为 IV】、其余为密文主体；AES-256-CBC + PKCS7。
 * 自测：decrypt("test key", "P37w+VZImNgPEO1RBhJ6RtKl7n6zymIbEG1pReEzghk=") = "hello world"
 */
export function decryptEvent(encryptKey: string, encryptB64: string): Record<string, unknown> | null {
  try {
    const key = createHash('sha256').update(encryptKey, 'utf8').digest()
    const blob = Buffer.from(encryptB64, 'base64')
    if (blob.length < 32) return null // 至少 IV(16) + 一个 AES 块
    const iv = blob.subarray(0, 16)
    const ct = blob.subarray(16)
    const decipher = createDecipheriv('aes-256-cbc', key, iv)
    const plain = Buffer.concat([decipher.update(ct), decipher.final()])
    return JSON.parse(plain.toString('utf8')) as Record<string, unknown>
  } catch {
    return null
  }
}

/** 从解密/明文后的回调体里取 Verification Token（兼容新旧两版事件结构） */
export function extractToken(body: Record<string, unknown>): string | null {
  if (typeof body.token === 'string') return body.token
  const header = body.header as Record<string, unknown> | undefined
  if (header && typeof header.token === 'string') return header.token
  return null
}

/** 事件类型（url_verification 特判在路由里；这里取通用类型） */
export function extractEventType(body: Record<string, unknown>): string | null {
  if (typeof body.type === 'string') return body.type // 旧版：url_verification / event_callback
  const header = body.header as Record<string, unknown> | undefined
  if (header && typeof header.event_type === 'string') return header.event_type // 新版
  return null
}
