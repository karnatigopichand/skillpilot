import { test } from 'node:test'
import assert from 'node:assert/strict'
import { answerResult, diagnosticView, displayPercentage, filterReview, foundationTopics } from '../src/modules/assessment/results-view.ts'
import type { Completed } from '../src/modules/assessment/progress.ts'

function fixture(): Completed {
  const correctByTopic = [3, 2, 3, 0, 3, 3]
  const questions = foundationTopics.flatMap((topic, t) => Array.from({ length: 3 }, (_, i) => ({ id: `q${t * 3 + i + 1}`, topicId: topic.id, conceptId: `${topic.id}.test`, difficulty: 'easy', prompt: `Test question ${t * 3 + i + 1}`, options: ['a', 'b', 'c', 'd'].map(id => ({ id, text: `Option ${id}` })) })))
  const feedback = questions.map((q, index) => { const isCorrect = index % 3 < correctByTopic[Math.floor(index / 3)]; return { questionId: q.id, selectedOptionId: isCorrect ? 'a' : 'b', correctOptionId: 'a', isCorrect, explanation: 'Test explanation', reference: { url: 'https://example.com', title: 'Test reference' } } })
  return {
    draft: { delivery: { attemptId: 'test', mode: 'diagnostic', topicId: null, stageId: 'stage-01', bankVersion: 'test', cycleId: null, receipt: 'test', issuedAt: 1, expiresAt: 2, questionCount: 18, bankSize: 18, warnings: [], questions }, answers: Object.fromEntries(feedback.map(f => [f.questionId, f.selectedOptionId])) },
    result: { attemptId: 'test', mode: 'diagnostic', topicId: null, stageId: 'stage-01', bankVersion: 'test', cycleId: null, correct: 14, total: 18, percentage: 100 * 14 / 18, topics: foundationTopics.map((topic, i) => ({ topicId: topic.id, correct: correctByTopic[i], total: 3 })), feedback },
    completedAt: '2026-10-07', fingerprint: 'test-only',
  }
}

test('14/18 displays 78%, 14 correct, 4 incorrect from actual result', () => {
  const view = diagnosticView(fixture())
  assert.deepEqual([view.correct, view.total, view.incorrect, view.percentage], [14, 18, 4, 78])
  assert.equal(view.topics.reduce((sum, topic) => sum + topic.correct, 0), view.correct)
  assert.equal(view.topics.reduce((sum, topic) => sum + topic.total, 0), view.total)
  assert.equal(displayPercentage(2, 3), 67)
  assert.equal(displayPercentage(0, 0), null)
})

test('topic accuracy labels stay separate from sparse diagnostic evidence', () => {
  const view = diagnosticView(fixture())
  assert.equal(view.topics[0].accuracy.label, 'All correct')
  assert.equal(view.topics[0].percentage, 100)
  assert.equal(view.topics[0].evidence, 'Insufficient evidence for mastery')
  assert.equal(view.topics[1].accuracy.label, 'Some incorrect')
  assert.equal(view.topics[1].percentage, 67)
  assert.equal(view.topics[3].accuracy.label, 'All incorrect')
  assert.equal(view.topics[3].percentage, 0)
  assert.deepEqual(answerResult(0, 0).label, 'Unassessed')
  const completed = fixture()
  completed.result.topics.pop()
  const unassessed = diagnosticView(completed).topics[5]
  assert.equal(unassessed.accuracy.label, 'Unassessed')
  assert.equal(unassessed.percentage, null)
  assert.equal(unassessed.evidence, 'Unknown — no scored questions')
})

test('combined LLM and Incorrect filter selects exactly the missed LLM question', () => {
  const view = diagnosticView(fixture())
  const missed = filterReview(view.review, 'ai-foundations-llms', 'incorrect')
  assert.equal(missed.length, 1)
  assert.equal(missed[0].question.id, 'q6')
  assert.equal(missed[0].number, 6)
  assert.equal(missed[0].question.topicId, 'ai-foundations-llms')
  assert.equal(missed[0].answer.selectedOptionId, 'b')
  assert.equal(missed[0].answer.correctOptionId, 'a')
  assert.equal(filterReview(view.review, 'ai-foundations-llms', 'correct').length, 2)
  assert.equal(filterReview(view.review, 'ai-foundations-llms', 'all').length, 3)
})

test('all-topic tab counts, reset and empty filter combinations are accurate', () => {
  const view = diagnosticView(fixture())
  assert.equal(filterReview(view.review, null, 'all').length, 18)
  assert.equal(filterReview(view.review, null, 'correct').length, 14)
  assert.equal(filterReview(view.review, null, 'incorrect').length, 4)
  assert.deepEqual(filterReview(view.review, 'ai-foundations-generative-ai', 'incorrect'), [])
  assert.deepEqual(filterReview(view.review, 'ai-foundations-context-windows', 'correct'), [])
  assert.equal(filterReview(view.review, null, 'incorrect').length, 4) // clearing only topic retains the tab
})

test('feedback order does not change original question numbering or mappings', () => {
  const completed = fixture()
  completed.result.feedback.reverse()
  const view = diagnosticView(completed)
  assert.deepEqual(view.review.map(item => item.number), Array.from({ length: 18 }, (_, i) => i + 1))
  const missed = filterReview(view.review, null, 'incorrect')
  assert.deepEqual(missed.map(item => item.number), [6, 10, 11, 12])
  assert.ok(view.review.every(item => item.question.id === item.answer.questionId))
})

test('zero-score diagnostic has no invented percentage or mastery evidence', () => {
  const completed = fixture()
  completed.result.correct = 0; completed.result.total = 0; completed.result.topics = []; completed.result.feedback = []
  completed.draft.delivery.questions = []
  const view = diagnosticView(completed)
  assert.equal(view.percentage, null)
  assert.equal(view.incorrect, 0)
  assert.equal(view.review.length, 0)
  assert.ok(view.topics.every(topic => topic.accuracy.label === 'Unassessed' && topic.evidence === 'Unknown — no scored questions'))
})
