import type { ResumeStrategyReport } from '../ai/report'

type ReportRow = {
  id: string
  inputHash: string
  completedAt: Date | null
  report: unknown
}

export function buildReportSummaryCard(
  report: ReportRow,
  state: { interestedCount: number; stale: boolean },
): Record<string, unknown> {
  const content = report.report as ResumeStrategyReport
  const elements: Record<string, unknown>[] = [
    {
      tag: 'markdown',
      content: `基于 ${content.source_summary.interested_job_count} 个感兴趣岗位 · ${content.directions.length} 个方向`,
    },
  ]
  for (const direction of content.directions) {
    elements.push({
      tag: 'markdown',
      content: `**${direction.name}**\n${direction.key_capabilities.map((item) => `• ${item}`).join('\n')}`,
    })
  }
  if (state.stale) {
    elements.push({ tag: 'markdown', content: "<font color='orange'>依据已变化，可在 Web 确认后更新。</font>" })
  }
  if (process.env.RESUME_STRATEGY_FEISHU_ACTION_ENABLED === 'true') {
    elements.push({
      tag: 'column_set',
      flex_mode: 'none',
      columns: [{
        tag: 'column', width: 'auto',
        elements: [{
          tag: 'button', type: 'default', content: '更新简历建议',
          behaviors: [{ type: 'callback', value: { action: 'resume_strategy_update', stage: 'submit', cardJobs: ['resume-strategy'] } }],
        }],
      }],
    })
  }
  return {
    schema: '2.0',
    config: { wide_screen_mode: true, update_multi: true },
    header: {
      template: 'wathet',
      title: { tag: 'plain_text', content: '简历方向建议' },
    },
    body: { elements },
  }
}
