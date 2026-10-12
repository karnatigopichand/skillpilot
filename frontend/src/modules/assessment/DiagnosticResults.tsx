import { useId, useState } from 'react'
import type { KeyboardEvent } from 'react'
import type { Completed } from './progress'
import { diagnosticView, filterReview, foundationTopics } from './results-view'
import type { AccuracyFilter } from './results-view'

export default function DiagnosticResults({ completed, saved, onBack, topics = foundationTopics, backLabel = "Back to assessments" }: { topics?: {id: string; title: string}[]; completed: Completed; saved: boolean; onBack: () => void; backLabel?: string }) {
  const [topicId, setTopicId] = useState<string | null>(null)
  const [accuracy, setAccuracy] = useState<AccuracyFilter>('all')
  const id = useId()
  const title = completed.result.mode === 'practice' ? 'Practice results' : completed.result.mode === 'reassessment' ? 'Reassessment results' : 'Diagnostic results'
  const view = diagnosticView(completed, topics)
  const scoped = filterReview(view.review, topicId, 'all')
  const shown = filterReview(view.review, topicId, accuracy)
  const tabs: { key: AccuracyFilter; title: string; count: number }[] = [
    { key: 'all', title: 'All', count: scoped.length },
    { key: 'correct', title: 'Correct', count: scoped.filter(item => item.answer.isCorrect).length },
    { key: 'incorrect', title: 'Incorrect', count: scoped.filter(item => !item.answer.isCorrect).length },
  ]
  const topicTitle = topics.find(topic => topic.id === topicId)?.title ?? 'All topics'
  function tabKey(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    let next: number
    if (event.key === 'ArrowRight') next = (index + 1) % tabs.length
    else if (event.key === 'ArrowLeft') next = (index + tabs.length - 1) % tabs.length
    else if (event.key === 'Home') next = 0
    else if (event.key === 'End') next = tabs.length - 1
    else return
    event.preventDefault()
    setAccuracy(tabs[next].key)
    document.getElementById(`${id}-tab-${tabs[next].key}`)?.focus()
  }
  const circumference = 2 * Math.PI * 52
  const fraction = view.total > 0 ? view.correct / view.total : 0
  return <div>
    <section className="panel" aria-labelledby={`${id}-heading`}>
      <h2 id={`${id}-heading`}>{title}</h2>
      <div className="flex items-center gap-6 flex-wrap">
        <figure className="relative shrink-0 w-40 h-40" aria-label={view.percentage === null ? 'No scored answers' : `${view.percentage}% correct; ${view.correct} correct and ${view.incorrect} incorrect out of ${view.total}`}>
          <svg viewBox="0 0 128 128" className="w-full h-full" aria-hidden="true">
            <circle cx="64" cy="64" r="52" fill="none" stroke={view.total ? '#e2a7a7' : '#dce3ed'} strokeWidth="15" />
            <circle cx="64" cy="64" r="52" fill="none" stroke="#15803d" strokeWidth="15" strokeDasharray={`${fraction * circumference} ${circumference}`} transform="rotate(-90 64 64)" />
          </svg>
          <figcaption className="absolute inset-0 flex flex-col items-center justify-center"><span className="text-3xl font-semibold">{view.percentage === null ? '—' : `${view.percentage}%`}</span><span className="text-sm text-slate-600">{view.total ? 'correct' : 'Unassessed'}</span></figcaption>
        </figure>
        <div><p className="text-lg font-semibold">{view.correct} / {view.total} correct{view.percentage !== null && ` · ${view.percentage}%`}</p>
          <p className="mt-2"><span aria-hidden="true" className="text-green-700">✓ </span>{view.correct} correct</p>
          <p><span aria-hidden="true" className="text-red-700">✕ </span>{view.incorrect} incorrect</p>
          <p className="text-sm text-slate-500 mt-3">{saved ? 'Saved locally.' : 'Not saved.'} {completed.result.mode === 'practice' ? 'Practice gives feedback and does not update mastery.' : completed.result.mode === 'reassessment' ? 'Mastery uses the latest qualifying reassessment; short attempts remain insufficient evidence.' : 'Accuracy on sampled questions does not establish mastery.'}</p>
        </div>
      </div>
    </section>
    <section className="panel" aria-labelledby={`${id}-topics`}>
      <h2 id={`${id}-topics`}>Topic results</h2>
      <p id={`${id}-table-help`} className="text-sm text-slate-500 mb-4">Select a topic to filter question review. On narrow screens, scroll the table horizontally. Answer accuracy and mastery evidence are separate.</p>
      <div className="overflow-x-auto" role="region" aria-label="Topic results table" aria-describedby={`${id}-table-help`} tabIndex={0}>
        <table className="w-full min-w-[660px] text-sm text-left border-collapse">
          <caption className="sr-only">{title} by stage topic</caption>
          <thead><tr className="border-b border-slate-300">{['Topic', 'Correct / Total', 'Percentage', 'Answer result', 'Mastery evidence'].map(label => <th scope="col" key={label} className="py-3 pr-4 font-semibold">{label}</th>)}</tr></thead>
          <tbody>{view.topics.map(topic => <tr key={topic.id} className={`border-b border-slate-200 cursor-pointer ${topicId === topic.id ? 'bg-blue-50' : 'hover:bg-slate-50'}`} onClick={() => setTopicId(topic.id)}>
            <th scope="row" className="py-3 pr-4"><button className="text-left min-h-11 text-blue-700 underline decoration-dotted" aria-pressed={topicId === topic.id} aria-controls={`${id}-review`} onClick={event => { event.stopPropagation(); setTopicId(topic.id) }}>{topic.title}{topicId === topic.id && <span className="block text-xs font-normal">Selected filter</span>}</button></th>
            <td className="py-3 pr-4">{topic.correct} / {topic.total}</td>
            <td className="py-3 pr-4">{topic.percentage === null ? '—' : `${topic.percentage}%`}</td>
            <td className={`py-3 pr-4 ${topic.accuracy.className}`}><span aria-hidden="true">{topic.accuracy.icon} </span>{topic.accuracy.label}</td>
            <td className="py-3 pr-4 text-slate-600">{topic.evidence}</td>
          </tr>)}</tbody>
        </table>
      </div>
    </section>
    <section id={`${id}-review`} className="panel" aria-labelledby={`${id}-review-heading`}>
      <h2 id={`${id}-review-heading`}>Question review</h2>
      <div className="flex items-center justify-between gap-3 flex-wrap mb-4"><p className="text-sm">Topic filter: <strong>{topicTitle}</strong></p><button className="secondary" onClick={() => setTopicId(null)} disabled={!topicId}>Show all topics</button></div>
      <div role="tablist" aria-label="Answer correctness" className="flex flex-wrap gap-2 border-b border-slate-200 pb-3">
        {tabs.map((tab, index) => <button key={tab.key} id={`${id}-tab-${tab.key}`} role="tab" aria-selected={accuracy === tab.key} aria-controls={`${id}-questions`} tabIndex={accuracy === tab.key ? 0 : -1} onKeyDown={event => tabKey(event, index)} onClick={() => setAccuracy(tab.key)} className={`nav-button ${accuracy === tab.key ? 'selected' : ''}`}>{tab.title} ({tab.count})</button>)}
      </div>
      <p role="status" className="text-sm text-slate-500 mt-4">Showing {shown.length} of {scoped.length} questions · {topicTitle} · {tabs.find(tab => tab.key === accuracy)?.title}</p>
      <div role="tabpanel" id={`${id}-questions`} aria-labelledby={`${id}-tab-${accuracy}`} tabIndex={0}>
        {shown.length === 0 ? <p className="py-6">No questions match this topic and answer-result filter. Choose All or show all topics.</p> : shown.map(({ question, answer, number }) => <article className="topic" key={question.id}>
          <div className="flex justify-between gap-3 flex-wrap mb-3"><span className="tag">{topics.find(topic => topic.id === question.topicId)?.title ?? question.topicId}</span><span className={answer.isCorrect ? 'text-green-700 text-sm' : 'text-red-700 text-sm'}><span aria-hidden="true">{answer.isCorrect ? '✓' : '✕'} </span>{answer.isCorrect ? 'Correct' : 'Incorrect'}</span></div>
          <h3>Question {number}. {question.prompt}</h3>
          <p>Your answer: <strong>{question.options.find(option => option.id === answer.selectedOptionId)?.text ?? 'Answer unavailable'}</strong></p>
          <p>Correct answer: <strong>{question.options.find(option => option.id === answer.correctOptionId)?.text ?? 'Answer unavailable'}</strong></p>
          <p className="mt-2">{answer.explanation}</p>
          <a className="text-blue-700 underline" href={answer.reference.url} target="_blank" rel="noreferrer">{answer.reference.title}</a>
        </article>)}
      </div>
    </section>
    <button className="secondary" onClick={onBack}>{backLabel}</button>
  </div>
}
