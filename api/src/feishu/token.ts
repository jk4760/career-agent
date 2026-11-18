// M4.5 施工项 1.1：tenant_access_token 获取 + 内存缓存（过期前 300s 刷新）
// 获取失败重试 2 次（间隔 2s）；未配置 APP_ID/SECRET 返回 null（调用方走降级）

interface TokenCache {
  token: string
  expiresAt: number
}

let cache: TokenCache | null = null

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

export function feishuAppConfigured(): boolean {
  return Boolean(
    process.env.FEISHU_APP_ID &&
      process.env.FEISHU_APP_SECRET &&
      process.env.FEISHU_VERIFICATION_TOKEN,
  )
}

export async function getTenantAccessToken(): Promise<string | null> {
  const appId = process.env.FEISHU_APP_ID
  const appSecret = process.env.FEISHU_APP_SECRET
  if (!appId || !appSecret) return null
  if (cache && cache.expiresAt - 300_000 > Date.now()) return cache.token

  for (let attempt = 0; attempt < 3; attempt++) {
    if (attempt > 0) await sleep(2000)
    try {
      const resp = await fetch(
        'https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ app_id: appId, app_secret: appSecret }),
          signal: AbortSignal.timeout(10_000),
        },
      )
      const data = (await resp.json()) as {
        code?: number
        tenant_access_token?: string
        expire?: number
        msg?: string
      }
      if (data.code === 0 && data.tenant_access_token) {
        cache = {
          token: data.tenant_access_token,
          expiresAt: Date.now() + (data.expire ?? 7200) * 1000,
        }
        return cache.token
      }
      console.error(`[feishu] token 获取失败(code=${data.code} msg=${data.msg})，第 ${attempt + 1} 次`)
    } catch (e) {
      console.error(
        `[feishu] token 请求异常（第 ${attempt + 1} 次）: ${e instanceof Error ? e.message : e}`,
      )
    }
  }
  return null
}
