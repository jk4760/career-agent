import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/**
 * crypto.randomUUID 仅在安全上下文（HTTPS/localhost）可用；
 * 站点当前是 http + 公网 IP，需要回退实现。M2 绑域名上 HTTPS 后可保留回退无害。
 */
export function uuid(): string {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID()
  return '10000000-1000-4000-8000-100000000000'.replace(/[018]/g, (c) => {
    const r = crypto.getRandomValues(new Uint8Array(1))[0]
    return (Number(c) ^ ((r & 0xf) >> (Number(c) / 4))).toString(16)
  })
}
