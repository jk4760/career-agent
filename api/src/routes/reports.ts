import { Hono } from 'hono'
import {
  cancelReport,
  generateReport,
  reportHistory,
  reportSnapshots,
  reportState,
  saveReportSelection,
} from '../ai/report'

function reportError(error: unknown) {
  const code = error instanceof Error ? error.message : 'REPORT_ERROR'
  const messages: Record<string, string> = {
    FEATURE_DISABLED: '简历方向报告功能未启用',
    NO_INTERESTED_JOBS: '还没有有效的感兴趣岗位',
    RESUME_REQUIRED: '请先填写当前简历（个人背景）',
    REPORT_BUSY: '已有报告生成任务进行中',
    REPORT_DAILY_LIMIT: '今日报告生成／更新次数已用完',
    BUDGET_EXCEEDED: '今日模型预算已用完',
  }
  return { error: messages[code] ?? '报告操作失败', code }
}

export const reportsRoute = new Hono()
  .get('/strategy', async (c) => c.json(await reportState()))
  .put('/strategy/selection', async (c) => {
    const body = await c.req.json().catch(() => ({}))
    return c.json(await saveReportSelection(body.selection))
  })
  .post('/strategy/generate', async (c) => {
    const body = await c.req.json().catch(() => ({}))
    try {
      return c.json(await generateReport(body))
    } catch (error) {
      return c.json(reportError(error), 400)
    }
  })
  .post('/strategy/:id/cancel', (c) => c.json({ canceled: cancelReport(c.req.param('id')) }))
  .get('/strategy/history', async (c) => c.json(await reportHistory()))
  .get('/strategy/:id/snapshots', async (c) => {
    const result = await reportSnapshots(c.req.param('id'))
    return result ? c.json(result) : c.json({ error: '报告不存在' }, 404)
  })
