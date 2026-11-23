import { API_BASE } from '@/lib/apiRepository'
import type { AIContextSelection } from '@/types'

export interface ResumeDirection {
  name: string
  summary: string
  key_capabilities: string[]
  priority_experiences: { title: string; reason: string; source_type: 'resume' | 'material'; source_id: string }[]
  evidence: { text: string; source_type: 'resume' | 'material'; source_id: string }[]
  gaps: string[]
}

export interface ResumeReportContent {
  resume_count: number
  overview: string
  sample_warning?: string
  directions: ResumeDirection[]
  source_summary: {
    interested_job_count: number
    resume_id: string
    resume_name: string
    material_ids: string[]
    material_count: number
  }
}

export interface ReportRow {
  id: string
  version: number
  status: 'generating' | 'done' | 'error' | 'truncated' | 'canceled'
  report: ResumeReportContent | null
  inputHash: string
  selection: AIContextSelection
  sourceJobIds: string[]
  model: string
  errorCode: string | null
  createdAt: string
  completedAt: string | null
}

export interface ReportState {
  enabled: boolean
  current: ReportRow | null
  generating: ReportRow | null
  latestTask: ReportRow | null
  selection: AIContextSelection
  interestedCount: number
  resumeAvailable: boolean
  materialCount: number
  diff: { added_job_ids: string[]; removed_job_ids: string[]; changed_job_ids: string[] }
  stale: boolean
  noChange: boolean
  dailyUsed: number
  dailyLimit: number
  budget: { totalCny: string; limitCny: string; percent: number; exhausted: boolean }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, init)
  const body = await response.json().catch(() => null)
  if (!response.ok) throw new Error(body?.error ?? `请求失败（${response.status}）`)
  return body as T
}

export function getReportState(): Promise<ReportState> {
  return request('/reports/strategy')
}

export function saveReportBasis(selection: AIContextSelection): Promise<ReportState> {
  return request('/reports/strategy/selection', {
    method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ selection }),
  })
}

export function generateResumeReport(
  selection: AIContextSelection,
  mode: 'initial' | 'update' | 'rebuild' = 'update',
): Promise<{ noChange: boolean; report: ReportRow }> {
  return request('/reports/strategy/generate', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ selection, mode }),
  })
}

export function cancelResumeReport(id: string) {
  return request(`/reports/strategy/${id}/cancel`, { method: 'POST' })
}

export function getReportHistory(): Promise<ReportRow[]> {
  return request('/reports/strategy/history')
}

export interface ReportSnapshot {
  id: string
  sourceType: 'resume' | 'material' | 'job'
  sourceId: string
  version: string
  hash: string
  content: string
}

export function getReportSnapshots(id: string): Promise<{ report: ReportRow; snapshots: ReportSnapshot[] }> {
  return request(`/reports/strategy/${id}/snapshots`)
}
