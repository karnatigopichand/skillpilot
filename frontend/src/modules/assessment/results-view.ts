import type { Completed } from './progress'

export const foundationTopics = [
  { id: 'ai-foundations-generative-ai', title: 'Generative AI' },
  { id: 'ai-foundations-llms', title: 'Large Language Models' },
  { id: 'ai-foundations-tokens', title: 'Tokens' },
  { id: 'ai-foundations-context-windows', title: 'Context Windows' },
  { id: 'ai-foundations-prompting', title: 'Prompting' },
  { id: 'ai-foundations-structured-outputs', title: 'Structured Outputs' },
]
export type AccuracyFilter = 'all' | 'correct' | 'incorrect'
export const displayPercentage = (correct: number, total: number): number | null => total > 0 ? Math.round(correct / total * 100) : null
export function answerResult(correct: number, total: number) {
  if (total === 0) return { label: 'Unassessed', icon: '—', className: 'text-slate-600' }
  if (correct === total) return { label: 'All correct', icon: '✓', className: 'text-green-700' }
  if (correct === 0) return { label: 'All incorrect', icon: '✕', className: 'text-red-700' }
  return { label: 'Some incorrect', icon: '◐', className: 'text-amber-800' }
}
export function diagnosticView(completed: Completed, catalog = foundationTopics) {
  const result = completed.result
  const feedback = new Map(result.feedback.map(item => [item.questionId, item]))
  // Numbering belongs to the delivered quiz, regardless of feedback or filter order.
  const review = completed.draft.delivery.questions.flatMap((question, index) => {
    const answer = feedback.get(question.id)
    return answer ? [{ question, answer, number: index + 1 }] : []
  })
  const topics = catalog.map(topic => {
    const score = result.topics.find(score => score.topicId === topic.id)
    const correct = score?.correct ?? 0, total = score?.total ?? 0
    return { ...topic, correct, total, percentage: displayPercentage(correct, total), accuracy: answerResult(correct, total), evidence: total === 0 ? 'Unknown — no scored questions' : result.mode === 'practice' ? 'Practice — does not update mastery' : result.mode === 'reassessment' && total >= 20 ? 'Qualifying reassessment — see topic evidence for current mastery' : 'Insufficient evidence for mastery' }
  })
  return { correct: result.correct, incorrect: result.total - result.correct, total: result.total, percentage: displayPercentage(result.correct, result.total), topics, review }
}
export function filterReview(review: ReturnType<typeof diagnosticView>['review'], topicId: string | null, accuracy: AccuracyFilter) {
  return review.filter(item => (!topicId || item.question.topicId === topicId) && (accuracy === 'all' || item.answer.isCorrect === (accuracy === 'correct')))
}
