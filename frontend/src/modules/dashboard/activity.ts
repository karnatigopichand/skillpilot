import type { Progress } from '../assessment/progress'
export function dashboardActivity(progress: Progress) {
  const latest = [...progress.completedAttempts].sort((a,b)=>Date.parse(b.completedAt)-Date.parse(a.completedAt))[0] ?? null
  return {count: progress.completedAttempts.length, latest}
}
