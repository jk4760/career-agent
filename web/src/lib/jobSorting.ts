import type { JobWithStatus } from '@/types'

type SortMode = 'score' | 'time'

function compareJobs(a: JobWithStatus, b: JobWithStatus, sort: SortMode): number {
  if (sort === 'score') {
    const byScore = b.score.final - a.score.final
    if (byScore !== 0) return byScore
    const byPosted = (b.postedAt ? Date.parse(b.postedAt) : 0) - (a.postedAt ? Date.parse(a.postedAt) : 0)
    if (byPosted !== 0) return byPosted
  } else {
    const byCollected = Date.parse(b.collectedAt) - Date.parse(a.collectedAt)
    if (byCollected !== 0) return byCollected
  }
  return a.id.localeCompare(b.id)
}

export function groupAllJobs(list: JobWithStatus[], sort: SortMode): JobWithStatus[] {
  const unclassified = list.filter((job) => job.status === 'new').sort((a, b) => compareJobs(a, b, sort))
  const classified = list.filter((job) => job.status !== 'new').sort((a, b) => compareJobs(a, b, sort))
  return [...unclassified, ...classified]
}
