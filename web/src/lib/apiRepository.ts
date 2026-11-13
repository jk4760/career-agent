import type {
  FeedbackAction,
  InterviewQuestion,
  JobStatus,
  JobWithStatus,
  Material,
  Preferences,
} from '@/types'
import { loadAISettings, saveAISettingsLocal } from './aiSettingsLocal'
import type { Repository } from './repository'

/**
 * M2：Repository 的 API 实现（Hono 后端 + Postgres），替换内存实现。
 * 方法签名与 v0.5 §7 完全一致；getAISettings/saveAISettings 依豁免条款保留 localStorage。
 */
export const API_BASE: string = import.meta.env.VITE_API_BASE ?? '/api'

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, init)
  if (!res.ok) {
    throw new Error(`${init?.method ?? 'GET'} ${path} failed: ${res.status}`)
  }
  return res.json() as Promise<T>
}

async function reqJson<T>(path: string, method: string, body: unknown): Promise<T> {
  return req<T>(path, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

export const apiRepository: Repository = {
  listJobs: (status?: JobStatus, sort?: 'score' | 'time') => {
    const params = new URLSearchParams()
    if (status) params.set('status', status)
    if (sort) params.set('sort', sort)
    const qs = params.toString()
    return req<JobWithStatus[]>(`/jobs${qs ? `?${qs}` : ''}`)
  },
  getJob: (id: string) => req<JobWithStatus | null>(`/jobs/${id}`),
  addFeedback: async (jobId: string, action: FeedbackAction, reason: string | null, comment?: string) => {
    await reqJson(`/jobs/${jobId}/feedback`, 'POST', { action, reason, comment })
  },

  listMaterials: () => req<Material[]>('/materials'),
  saveMaterial: (m: Material) => reqJson<Material>('/materials', 'POST', m),
  deleteMaterial: async (id: string) => {
    await req(`/materials/${id}`, { method: 'DELETE' })
  },
  listFacets: () => req<{ value: string; count: number }[]>('/facets'),

  listQuestions: () => req<InterviewQuestion[]>('/questions'),
  saveQuestion: (q: InterviewQuestion) => reqJson<InterviewQuestion>('/questions', 'POST', q),
  deleteQuestion: async (id: string) => {
    await req(`/questions/${id}`, { method: 'DELETE' })
  },

  getPreferences: () => req<Preferences>('/preferences'),
  savePreferences: (p: Preferences) => reqJson<Preferences>('/preferences', 'PUT', p),

  putAttachmentFile: async (materialId: string, file: File) => {
    const form = new FormData()
    form.append('file', file)
    await req(`/materials/${materialId}/attachments`, { method: 'POST', body: form })
  },
  getAttachmentFile: async (materialId: string, name: string) => {
    const res = await fetch(
      `${API_BASE}/materials/${materialId}/attachments/${encodeURIComponent(name)}/download`,
    )
    if (res.status === 404) return null
    if (!res.ok) throw new Error(`download failed: ${res.status}`)
    return new File([await res.blob()], name)
  },

  // 豁免条款第二条：AI 对话配置不走 API，保留 localStorage
  getAISettings: async () => loadAISettings(),
  saveAISettings: async (s) => saveAISettingsLocal(s),
}
