import { test } from 'node:test'
import assert from 'node:assert/strict'
import { complete, emptyProgress, restore, saveProgress } from '../src/modules/assessment/progress.ts'
import type { Draft, Result } from '../src/modules/assessment/progress.ts'

function fixture(mode: 'diagnostic' | 'practice' | 'reassessment', id = 'attempt-1') {
  const topicId = mode === 'diagnostic' ? null : 'ai-foundations-tokens'
  const delivery = { attemptId: id, mode, topicId, stageId: 'stage-01', bankVersion: 'sample-0.1', cycleId: topicId ? 'cycle-1' : null, receipt: 'signed-receipt', issuedAt: 1, expiresAt: 9999999999, questionCount: 1, bankSize: 3, warnings: [], questions: [{ id: 'q1', topicId: 'ai-foundations-tokens', conceptId: 'tokens.counting', difficulty: 'easy', prompt: 'Test only', options: ['a','b','c','d'].map(id => ({ id, text: `Test option ${id}` })) }] }
  const draft: Draft = { delivery, answers: { q1: 'a' } }
  const result: Result = { attemptId: id, mode, topicId, stageId: 'stage-01', bankVersion: 'sample-0.1', cycleId: delivery.cycleId, correct: 1, total: 1, percentage: 100, topics: [{ topicId: 'ai-foundations-tokens', correct: 1, total: 1 }], feedback: [{ questionId: 'q1', selectedOptionId: 'a', correctOptionId: 'a', isCorrect: true, explanation: 'Test only', reference: { url: 'https://example.com', title: 'test' } }] }
  const p = emptyProgress()
  if (topicId) p.topicCycles[topicId] = { bankVersion: delivery.bankVersion, cycleId: 'cycle-1', usedQuestionIds: [] }
  p.activeAttempt = draft
  return { p, draft, result }
}

test('refresh preserves exact draft and completed question history', () => {
  const { p, draft, result } = fixture('practice')
  assert.deepEqual(restore(JSON.stringify(p)).activeAttempt, draft)
  const next = complete(p, draft, result, '2026-10-07')
  const refreshed = restore(JSON.stringify(next))
  assert.equal(refreshed.activeAttempt, undefined)
  assert.deepEqual(refreshed.topicCycles['ai-foundations-tokens'].usedQuestionIds, ['q1'])
  assert.equal(refreshed.completedAttempts.length, 1)
})

test('retry cannot duplicate completion or overwrite conflicting answers', () => {
  const { p, draft, result } = fixture('reassessment')
  const next = complete(p, draft, result)
  assert.equal(complete(next, draft, result).completedAttempts.length, 1)
  assert.throws(() => complete(next, { ...draft, answers: { q1: 'b' } }, result))
})

test('abandoned draft consumes nothing; diagnostic baseline and exposure remain separate', () => {
  const { p, draft, result } = fixture('diagnostic')
  delete p.activeAttempt
  assert.equal(p.completedAttempts.length, 0)
  assert.deepEqual(p.topicCycles, {})
  const baseline = complete(p, draft, result)
  const later = fixture('diagnostic', 'attempt-2')
  const next = complete(baseline, later.draft, later.result)
  assert.equal(next.initialDiagnosticAttemptId, 'attempt-1')
  assert.equal(next.completedAttempts.length, 2)
  assert.deepEqual(next.topicCycles, {})
  assert.deepEqual(next.diagnosticExposure['sample-0.1'], ['q1'])
})

test('explicit new cycle permits repeats without deleting prior attempts', () => {
  const { p, draft, result } = fixture('practice')
  const next = complete(p, draft, result)
  assert.throws(() => complete(next, { ...draft, delivery: { ...draft.delivery, attemptId: 'attempt-2' } }, { ...result, attemptId: 'attempt-2' }))
  next.topicCycles['ai-foundations-tokens'] = { bankVersion: 'sample-0.1', cycleId: 'cycle-2', usedQuestionIds: [] }
  const secondDraft = { ...draft, delivery: { ...draft.delivery, attemptId: 'attempt-2', cycleId: 'cycle-2' } }
  const secondResult = { ...result, attemptId: 'attempt-2', cycleId: 'cycle-2' }
  assert.equal(complete(next, secondDraft, secondResult).completedAttempts.length, 2)
})

test('corrupt and incompatible storage are rejected without silent reset', () => {
  for (const raw of ['{', '{}', JSON.stringify({ ...emptyProgress(), schemaVersion: 3 }), JSON.stringify({ ...emptyProgress(), initialDiagnosticAttemptId: 'missing' })]) assert.throws(() => restore(raw))
})

test('atomic storage failure and stale-tab rejection preserve previously saved history', () => {
  const { p, draft, result } = fixture('practice')
  const original = JSON.stringify(p)
  let raw = original
  let fail = true
  const storage = { getItem: () => raw, setItem: (_key: string, value: string) => { if (fail) throw new Error('quota'); raw = value } }
  const next = complete(p, draft, result)
  assert.throws(() => saveProgress(storage, next, original), /quota/)
  assert.equal(raw, original)
  fail = false
  const saved = saveProgress(storage, next, original)
  assert.equal(restore(saved).completedAttempts.length, 1)
  assert.deepEqual(restore(saved).topicCycles['ai-foundations-tokens'].usedQuestionIds, ['q1'])
  assert.throws(() => saveProgress(storage, p, original), /another tab/)
  assert.equal(raw, saved)
})

test('twenty persisted mixed-mode completions consume exactly 400 unique IDs', () => {
  let p = emptyProgress()
  p.topicCycles['ai-foundations-tokens'] = { bankVersion: 'sample-0.1', cycleId: 'cycle-1', usedQuestionIds: [] }
  for (let attempt = 0; attempt < 20; attempt++) {
    const { draft, result } = fixture(attempt % 2 ? 'practice' : 'reassessment', `attempt-${attempt}`)
    const template = draft.delivery.questions[0]
    draft.delivery.questions = Array.from({ length: 20 }, (_, i) => ({ ...template, id: `test-${attempt * 20 + i}` }))
    draft.delivery.questionCount = 20; draft.delivery.bankSize = 400
    draft.answers = Object.fromEntries(draft.delivery.questions.map(q => [q.id, 'a']))
    result.total = 20; result.correct = 20
    result.topics[0].total = 20; result.topics[0].correct = 20
    result.feedback = draft.delivery.questions.map(q => ({ ...result.feedback[0], questionId: q.id }))
    p = restore(JSON.stringify(complete(p, draft, result)))
  }
  assert.equal(p.completedAttempts.length, 20)
  assert.equal(p.topicCycles['ai-foundations-tokens'].usedQuestionIds.length, 400)
  assert.equal(new Set(p.topicCycles['ai-foundations-tokens'].usedQuestionIds).size, 400)
})

test('saved result bindings, accuracy and topic totals reject corruption without clearing raw data',()=>{
  const {p,draft,result}=fixture('practice')
  const valid=complete(p,draft,result)
  const mutations=[
    (p:ReturnType<typeof emptyProgress>)=>{p.completedAttempts[0].result.percentage=78},
    (p:ReturnType<typeof emptyProgress>)=>{p.completedAttempts[0].result.correct=0},
    (p:ReturnType<typeof emptyProgress>)=>{p.completedAttempts[0].result.stageId='stage-02'},
    (p:ReturnType<typeof emptyProgress>)=>{p.completedAttempts[0].completedAt='invalid'},
    (p:ReturnType<typeof emptyProgress>)=>{p.completedAttempts[0].result.topics[0].total=2},
    (p:ReturnType<typeof emptyProgress>)=>{p.completedAttempts[0].result.feedback[0].correctOptionId='missing'},
    (p:ReturnType<typeof emptyProgress>)=>{p.topicCycles['ai-foundations-tokens'].usedQuestionIds=[]},
    (p:ReturnType<typeof emptyProgress>)=>{p.activeAttempt=p.completedAttempts[0].draft},
  ]
  for(const mutate of mutations){const changed=structuredClone(valid);mutate(changed);const raw=JSON.stringify(changed);assert.throws(()=>restore(raw));assert.equal(JSON.stringify(changed),raw)}
  assert.deepEqual(restore(JSON.stringify(valid)),valid)
})

test('expired drafts remain recoverable and diagnostic exposure cannot be fabricated',()=>{
  const {p,draft,result}=fixture('diagnostic')
  draft.delivery.expiresAt=2
  assert.deepEqual(restore(JSON.stringify(p)).activeAttempt,draft)
  const valid=complete(p,draft,result)
  const bad=structuredClone(valid);bad.diagnosticExposure['sample-0.1'].push('invented')
  assert.throws(()=>restore(JSON.stringify(bad)))
  const noBaseline=structuredClone(valid);delete noBaseline.initialDiagnosticAttemptId
  assert.throws(()=>restore(JSON.stringify(noBaseline)))
})

test('50-question release cycle restores 20/20/10 completed attempts and preserves historical baseline',()=>{
  let p=emptyProgress()
  const baseline=fixture('diagnostic','historical-baseline')
  p=complete(p,baseline.draft,baseline.result)
  const topic='ai-foundations-tokens'
  p.topicCycles[topic]={bankVersion:'foundations-50-v1',cycleId:'release-cycle',usedQuestionIds:[]}
  for(const [attempt,size] of [20,20,10].entries()){
    const {draft,result}=fixture(attempt===1?'reassessment':'practice',`release-${attempt}`)
    draft.delivery.bankVersion='foundations-50-v1';draft.delivery.cycleId='release-cycle';draft.delivery.bankSize=50;draft.delivery.questionCount=size
    const first=attempt*20
    draft.delivery.questions=Array.from({length:size},(_,i)=>({...draft.delivery.questions[0],id:`release-q-${first+i}`}))
    draft.answers=Object.fromEntries(draft.delivery.questions.map(q=>[q.id,'a']))
    result.bankVersion='foundations-50-v1';result.cycleId='release-cycle';result.correct=size;result.total=size;result.percentage=100
    result.topics=[{topicId:topic,correct:size,total:size}]
    result.feedback=draft.delivery.questions.map(q=>({...result.feedback[0],questionId:q.id}))
    p=restore(JSON.stringify(complete(p,draft,result)))
    assert.equal(p.initialDiagnosticAttemptId,'historical-baseline')
  }
  assert.equal(p.topicCycles[topic].usedQuestionIds.length,50)
  assert.equal(new Set(p.topicCycles[topic].usedQuestionIds).size,50)
  assert.equal(p.completedAttempts.length,4)
  assert.deepEqual(p.diagnosticExposure['sample-0.1'],['q1'])
})
