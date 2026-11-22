import { API_BASE } from '@/lib/apiRepository'
import type { AIContextEstimate, AIContextSelection, AIConversation, AIMessage } from '@/types'

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, init)
  if (!response.ok) {
    const body = await response.json().catch(() => null)
    throw new Error(body?.error ?? `请求失败（${response.status}）`)
  }
  return response.json() as Promise<T>
}

export function listAIConversations(): Promise<AIConversation[]> {
  return request('/ai/conversations')
}

export function createAIConversation(): Promise<AIConversation> {
  return request('/ai/conversations', { method: 'POST' })
}

export function getAIConversation(id: string): Promise<AIConversation & { messages: AIMessage[] }> {
  return request(`/ai/conversations/${id}`)
}

export function estimateAIContext(selection: AIContextSelection): Promise<AIContextEstimate> {
  return request('/ai/context/estimate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ selection }),
  })
}

export function saveAIContext(id: string, selection: AIContextSelection) {
  return request<{ estimate: AIContextEstimate }>(`/ai/conversations/${id}/context`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ selection }),
  })
}

export function streamAIChat(input: {
  conversationId: string
  content: string
  clientRequestId: string
}): Promise<Response> {
  return fetch(`${API_BASE}/ai/chat/stream`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  })
}

export function stopAIChat(messageId: string): Promise<{ stopped: boolean }> {
  return request(`/ai/messages/${messageId}/stop`, { method: 'POST' })
}
