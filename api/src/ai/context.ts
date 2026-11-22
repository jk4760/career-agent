import { createHash } from 'node:crypto'
import { inArray } from 'drizzle-orm'
import { jobs, materials, preferences } from '../../../db/schema'
import { db } from '../db'

export interface ContextSelection {
  includePreferences: boolean
  resumeId: string | null
  materialIds: string[]
  jobIds: string[]
}

export interface ContextSegment {
  sourceType: 'preferences' | 'resume' | 'material' | 'job'
  sourceId: string
  name: string
  content: string
  length: number
  version: string
  hash: string
}

export const CONTEXT_LIMITS = {
  questionChars: 4000,
  resumeChars: 6000,
  materialChars: 6000,
  totalChars: 24000,
  materials: 3,
  historyRounds: 6,
}

export class ContextError extends Error {
  readonly code = 'CONTEXT_INVALID'
}

export function hashContent(content: string): string {
  return createHash('sha256').update(content).digest('hex')
}

export async function defaultContextSelection(): Promise<ContextSelection> {
  const [prefs] = await db.select().from(preferences).limit(1)
  return {
    includePreferences: true,
    resumeId: prefs?.id ?? null,
    materialIds: [],
    jobIds: [],
  }
}

export function normalizeContextSelection(input: unknown, fallback: ContextSelection): ContextSelection {
  const value = (input ?? {}) as Record<string, unknown>
  return {
    includePreferences:
      typeof value.includePreferences === 'boolean'
        ? value.includePreferences
        : fallback.includePreferences,
    resumeId: typeof value.resumeId === 'string' ? value.resumeId : fallback.resumeId,
    materialIds: Array.isArray(value.materialIds)
      ? [...new Set(value.materialIds.filter((id): id is string => typeof id === 'string'))]
      : fallback.materialIds,
    jobIds: Array.isArray(value.jobIds)
      ? [...new Set(value.jobIds.filter((id): id is string => typeof id === 'string'))]
      : fallback.jobIds,
  }
}

function segment(
  sourceType: ContextSegment['sourceType'],
  sourceId: string,
  name: string,
  content: string,
  version: Date,
): ContextSegment {
  return {
    sourceType,
    sourceId,
    name,
    content,
    length: content.length,
    version: version.toISOString(),
    hash: hashContent(content),
  }
}

export async function assembleContext(selection: ContextSelection, enforceLimits = true) {
  if (selection.materialIds.length > CONTEXT_LIMITS.materials) {
    throw new ContextError(`素材最多选择 ${CONTEXT_LIMITS.materials} 个`)
  }
  const [prefs] = await db.select().from(preferences).limit(1)
  if (selection.resumeId && (!prefs || prefs.id !== selection.resumeId)) {
    throw new ContextError('当前简历 ID 无效')
  }
  const segments: ContextSegment[] = []
  if (selection.includePreferences && prefs) {
    const content = [
      `目标行业：${(prefs.industries ?? []).join('、') || '未设置'}`,
      `目标职能：${(prefs.roles ?? []).join('、') || '未设置'}`,
      `目标城市：${(prefs.locations ?? []).join('、') || '不限'}`,
      `期望薪资下限：${prefs.salaryMin ?? '未设置'}`,
      `包含关键词：${(prefs.keywordsInclude ?? []).join('、') || '无'}`,
      `排除关键词：${(prefs.keywordsExclude ?? []).join('、') || '无'}`,
      `经验年限上限：${prefs.experienceMin ?? '不限'}`,
    ].join('\n')
    segments.push(segment('preferences', prefs.id, '求职偏好', content, prefs.updatedAt))
  }
  if (selection.resumeId && prefs?.backgroundText) {
    segments.push(
      segment('resume', prefs.id, '当前简历（个人背景）', prefs.backgroundText, prefs.updatedAt),
    )
  }

  if (selection.materialIds.length) {
    const rows = await db.select().from(materials).where(inArray(materials.id, selection.materialIds))
    const byId = new Map(rows.map((row) => [row.id, row]))
    for (const id of selection.materialIds) {
      const row = byId.get(id)
      if (!row) throw new ContextError(`素材不存在: ${id}`)
      const content = [
        `项目：${row.project}`,
        `标题：${row.title}`,
        row.role ? `角色：${row.role}` : '',
        row.metrics ? `关键成果：${row.metrics}` : '',
        row.content ?? '',
      ].filter(Boolean).join('\n')
      segments.push(segment('material', row.id, row.title, content, row.updatedAt))
    }
  }

  if (selection.jobIds.length) {
    const rows = await db.select().from(jobs).where(inArray(jobs.id, selection.jobIds))
    const byId = new Map(rows.map((row) => [row.id, row]))
    for (const id of selection.jobIds) {
      const row = byId.get(id)
      if (!row) throw new ContextError(`岗位不存在: ${id}`)
      const content = [
        `${row.company} · ${row.title}`,
        `地点：${row.location ?? '未知'}`,
        row.description ?? '',
      ].join('\n')
      segments.push(segment('job', row.id, `${row.company} · ${row.title}`, content, row.collectedAt))
    }
  }

  const resumeChars = segments
    .filter((item) => item.sourceType === 'resume')
    .reduce((sum, item) => sum + item.length, 0)
  const materialChars = segments
    .filter((item) => item.sourceType === 'material')
    .reduce((sum, item) => sum + item.length, 0)
  const totalChars = segments.reduce((sum, item) => sum + item.length, 0)
  const exceeds =
    resumeChars > CONTEXT_LIMITS.resumeChars ||
    materialChars > CONTEXT_LIMITS.materialChars ||
    totalChars > CONTEXT_LIMITS.totalChars
  if (enforceLimits && exceeds) throw new ContextError('上下文超过允许上限，请减少资料')

  return {
    selection,
    segments,
    resumeChars,
    materialChars,
    totalChars,
    limitChars: CONTEXT_LIMITS.totalChars,
    exceeds,
    snapshot: {
      selection,
      sources: segments.map(({ content: _content, ...meta }) => meta),
    },
    prompt: segments
      .map((item) => `【${item.name}】\n${item.content}`)
      .join('\n\n'),
  }
}
