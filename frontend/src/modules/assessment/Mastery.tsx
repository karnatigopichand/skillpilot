import type { ReactNode } from 'react'
import { statusAppearance } from './workspace'

export function StatusBadge({status}: {status?: string}) {
  const appearance = statusAppearance(status)
  return <span className={`evidence-badge evidence-${appearance.tone}`}><span aria-hidden="true">{appearance.icon} </span>{appearance.label}</span>
}

type Summary = { attemptId: string; mode: string; completedAt: string; correct: number; total: number; percentage: number; bankVersion: string }
type Topic = { topicId: string; status: string; baseline: Summary | null; latestReassessment: Summary | null; latestEligible: Summary | null; evidenceReason: string; observedDifference: number | null }
const score = (s: Summary) => `${s.correct}/${s.total} correct · ${Math.round(s.percentage)}%`
const date = (s: Summary) => new Date(s.completedAt).toLocaleDateString()
const guidance: Record<string,string> = {
  Strong: 'You can move on or review this topic whenever you like.',
  Developing: 'Review the lesson and practice, then take another full reassessment.',
  'Needs Attention': 'Focus on this topic: read the lesson and practice before reassessing.',
  'Insufficient Evidence': 'A diagnostic or short reassessment is not enough to establish your topic status. Complete a reassessment with at least 20 questions.',
  Unknown: 'No diagnostic or reassessment result is available for the current question set. You can start with the lesson, practice or a full reassessment.',
}
export function TopicEvidence({topic,historicalBaseline,action}: {topic: Topic; historicalBaseline?: Summary; action?: ReactNode}) {
  const latest = topic.latestEligible
  const starting = topic.baseline ?? historicalBaseline
  const short = topic.latestReassessment && topic.latestReassessment.total < 20 ? topic.latestReassessment : null
  return <section className="panel topic-status-card">
    <div className="flex items-center justify-between gap-3 flex-wrap"><h2>Your topic status</h2><StatusBadge status={topic.status}/></div>
    {latest && <><p>Based on your latest full reassessment: <strong>{score(latest)}</strong>.</p><p className="text-sm text-slate-500 mt-1">Taken {date(latest)}</p></>}
    <p className="mt-3">{guidance[topic.status] ?? 'Your topic status is currently unavailable.'}</p>
    {short && <p className="text-sm text-amber-800 mt-3">Your latest reassessment had {short.total} questions ({score(short)}), fewer than the 20 needed to update your status.{latest ? ` Your status still uses the full reassessment taken ${date(latest)}.` : ''}</p>}
    {action}
    <details className="topic-status-details mt-4">
      <summary className="font-medium">How this status is determined</summary>
      <p className="mt-3">Your status uses your latest reassessment with at least 20 questions from the current question set. Practice and diagnostics do not assign a mastery status.</p>
      <dl className="status-rules mt-3">
        <div><dt>Strong</dt><dd>85% or higher</dd></div>
        <div><dt>Developing</dt><dd>60% to below 85%</dd></div>
        <div><dt>Needs Attention</dt><dd>Below 60%</dd></div>
      </dl>
      <p className="text-sm text-slate-500 mt-2">The exact score determines the status; displayed percentages are rounded. This is a learning indicator, not certification.</p>
      <h3 className="mt-4">Starting diagnostic</h3>
      <p className="text-sm">Your result on this topic’s questions in your first stage diagnostic is your starting snapshot. It is not a full topic assessment.</p>
      {starting ? <><p className="mt-2"><strong>{score(starting)}</strong> · {date(starting)}</p>{!topic.baseline && historicalBaseline && <p className="text-sm text-slate-500">This snapshot is from an earlier question set and does not determine your current status.</p>}</> : <p className="mt-2">No starting diagnostic result is available for this topic.</p>}
      {latest && <p className="text-sm text-slate-500 mt-3">Status source: reassessment on {date(latest)} · Question set: {latest.bankVersion}</p>}
      {topic.observedDifference !== null && <p className="text-sm text-slate-500 mt-3">Observed score difference from the starting snapshot: {topic.observedDifference > 0 ? '+' : ''}{topic.observedDifference.toFixed(1)} percentage points. The question samples differ, so this is not a reliable measure of learning gain.</p>}
    </details>
  </section>
}
