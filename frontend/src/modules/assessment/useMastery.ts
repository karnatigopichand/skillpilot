import { useEffect, useState } from 'react'
import type { Progress } from './progress'
type Summary = { attemptId: string; mode: string; completedAt: string; correct: number; total: number; percentage: number; bankVersion: string }
type Topic = { topicId: string; status: string; baseline: Summary | null; latestReassessment: Summary | null; latestEligible: Summary | null; evidenceReason: string; observedDifference: number | null }
type Plan = { topics: Topic[]; recommendations: { topicId: string; reason: string; action: string }[]; optionalReview: { topicId: string; reason: string }[] }
export function useMastery(progress: Progress, bankVersion: string, stageId = 'stage-01') {
  const [state, setState] = useState<{ plan?: Plan; error?: string; loading: boolean; key?: string }>({ loading: true })
  const [retry, setRetry] = useState(0)
  const current = progress.completedAttempts.filter(c => c.result.bankVersion === bankVersion && c.result.stageId === stageId)
  const baseline = progress.initialDiagnosticByStage?.[stageId] ?? (stageId === 'stage-01' ? progress.initialDiagnosticAttemptId : undefined)
  const historicalBaseline = Boolean(baseline && !current.some(c => c.result.attemptId === baseline))
  const evidenceKey = JSON.stringify({ schemaVersion: 1, stageId, curriculumVersion: progress.curriculumVersion, bankVersion, initialDiagnosticAttemptId: baseline ?? null, historicalBaseline, attempts: current.map(c => ({ receipt: c.draft.delivery.receipt, answers: Object.entries(c.draft.answers).map(([questionId, optionId]) => ({ questionId, optionId })), completedAt: c.completedAt })) })
  useEffect(() => {
    if (!bankVersion) return
    const controller = new AbortController()
    fetch('/api/mastery/evaluate', { method: 'POST', signal: controller.signal, headers: { 'Content-Type': 'application/json' }, body: evidenceKey })
      .then(async response => { const value = await response.json(); if (!response.ok) throw new Error(value.detail?.message ?? 'Evidence evaluation failed.'); return value as Plan })
      .then(plan => { if (!controller.signal.aborted) setState({ plan, loading: false, key: evidenceKey }) })
      .catch(e => { if (!controller.signal.aborted) setState({ error: e.message, loading: false, key: evidenceKey }) })
    return () => controller.abort()
  }, [evidenceKey, retry, bankVersion]) // Evidence changes re-evaluate; draft edits never change evidence.
  return { ...state, loading: state.loading || state.key !== evidenceKey, retry: () => { setState({ loading: true }); setRetry(r => r + 1) } }
}

