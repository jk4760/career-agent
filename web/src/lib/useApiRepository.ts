import { useMemo, useState } from 'react'
import { apiRepository } from './apiRepository'
import type { Repository } from './repository'

// 变更类方法：调用成功后 bump tick → 生成新 repo 实例 → 页面 effect 自动重取。
// 只包装写操作；读操作原样透传（否则 effect 会无限循环）。
const MUTATING = [
  'addFeedback',
  'saveMaterial',
  'deleteMaterial',
  'saveQuestion',
  'deleteQuestion',
  'savePreferences',
  'saveAISettings',
  'putAttachmentFile',
] as const

/**
 * apiRepository 的 React 封装：保持「变更后 repo 换实例、页面自动重取」的既有约定
 * （与 v0.5 内存实现的行为一致），页面代码零改动。
 */
export function useApiRepository(): Repository {
  const [tick, setTick] = useState(0)

  return useMemo(() => {
    void tick
    const repo = { ...apiRepository }
    for (const key of MUTATING) {
      const original = repo[key] as (...args: unknown[]) => Promise<unknown>
      ;(repo as Record<string, unknown>)[key] = async (...args: unknown[]) => {
        const result = await original(...args)
        setTick((t) => t + 1)
        return result
      }
    }
    return repo
  }, [tick])
}
