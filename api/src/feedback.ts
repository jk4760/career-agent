// M4.5：反馈服务（Web 路由与飞书卡片回调复用同一入口，负面清单：不复制反馈逻辑）
// 规则：不合适必选六选一；感兴趣可选三选；applied 不带 reason；
// 同岗位 10 分钟内重复提交视为同一次（取消窗口内旧记录，以最新为准，设计稿 §3.4）
import { and, desc, eq, gte, isNull, sql } from 'drizzle-orm'
import { feedbackEvents, jobs } from '../../db/schema'
import { db } from './db'

export const PASS_REASONS = ['职能', '薪资', '地点', '职级', '公司', '其他'] as const
export const INTERESTED_REASONS = ['职能对口', '薪资满意', '公司想去', '面试练习'] as const
export type FeedbackAction = 'interested' | 'pass' | 'applied'

// 卡片按钮文案 → Web 枚举（设计稿 §3.1 展示文案与 Web 枚举的映射）
export const CARD_REASON_TO_ENUM: Record<string, string> = {
  职能不匹配: '职能',
  薪资不满意: '薪资',
  地点不合适: '地点',
  职级不匹配: '职级',
  公司不考虑: '公司',
  其他: '其他',
}

export interface AddFeedbackResult {
  ok: boolean
  error?: string
  event?: typeof feedbackEvents.$inferSelect
}

export async function addFeedback(
  jobId: string,
  action: FeedbackAction,
  reason?: string | null,
  comment?: string,
): Promise<AddFeedbackResult> {
  if (
    action === 'pass' &&
    !(reason && PASS_REASONS.includes(reason as (typeof PASS_REASONS)[number]))
  ) {
    return { ok: false, error: '不合适必须选择原因（职能/薪资/地点/职级/公司/其他）' }
  }
  if (
    action === 'interested' &&
    reason &&
    !INTERESTED_REASONS.includes(reason as (typeof INTERESTED_REASONS)[number])
  ) {
    return { ok: false, error: '感兴趣原因必须是：职能对口/薪资满意/公司想去/面试练习' }
  }
  const [job] = await db.select({ id: jobs.id }).from(jobs).where(eq(jobs.id, jobId))
  if (!job) return { ok: false, error: 'job not found' }

  // 幂等（设计稿 §3.4）：只取消「10 分钟内」的有效旧记录，历史反馈不动
  await db
    .update(feedbackEvents)
    .set({ canceledAt: new Date() })
    .where(
      and(
        eq(feedbackEvents.jobId, jobId),
        isNull(feedbackEvents.canceledAt),
        gte(feedbackEvents.createdAt, sql`now() - interval '10 minutes'`),
      ),
    )

  const [event] = await db
    .insert(feedbackEvents)
    .values({
      jobId,
      action,
      reason: action === 'applied' ? null : (reason ?? null),
      comment: comment?.trim() ? comment.trim() : null,
    })
    .returning()
  return { ok: true, event }
}

/** 撤销（设计稿 §3.3）：仅 10 分钟窗口内；返回被撤销的事件或失败原因 */
export async function cancelFeedback(
  eventId: string,
): Promise<{ ok: boolean; error?: string; jobId?: string }> {
  const [event] = await db
    .select()
    .from(feedbackEvents)
    .where(and(eq(feedbackEvents.id, eventId), isNull(feedbackEvents.canceledAt)))
  if (!event) return { ok: false, error: '反馈不存在或已撤销' }
  const ageMs = Date.now() - event.createdAt.getTime()
  if (ageMs > 10 * 60 * 1000) return { ok: false, error: '超过 10 分钟撤销窗口，无法撤销' }
  await db.update(feedbackEvents).set({ canceledAt: new Date() }).where(eq(feedbackEvents.id, eventId))
  return { ok: true, jobId: event.jobId }
}

/** 岗位最近一条有效反馈（推送渲染态③ / 回调后重建卡片用） */
export async function latestActiveFeedback(jobId: string) {
  const [event] = await db
    .select()
    .from(feedbackEvents)
    .where(and(eq(feedbackEvents.jobId, jobId), isNull(feedbackEvents.canceledAt)))
    .orderBy(desc(feedbackEvents.createdAt))
    .limit(1)
  return event ?? null
}
