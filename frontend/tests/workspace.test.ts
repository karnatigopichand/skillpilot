import { test } from 'node:test'
import assert from 'node:assert/strict'
import { statusAppearance, historyAttempts, readWorkspace, selectTopic, sidebarStatus, workspaceHash } from '../src/modules/assessment/workspace.ts'
import type { Completed } from '../src/modules/assessment/progress.ts'

test('topic and tab selection round-trip through browser history URLs', () => {
  const initial=readWorkspace('#stage/stage-01')
  assert.equal(initial.tab,'overview');assert.equal(initial.topicId,null)
  const topic=selectTopic(initial,'ai-foundations-llms')
  const assessments={...topic,tab:'assessments' as const}
  const history={...assessments,tab:'history' as const,historyScope:'selected' as const}
  assert.equal(readWorkspace(workspaceHash(assessments)).topicId,'ai-foundations-llms')
  assert.deepEqual(readWorkspace(workspaceHash(history)),history)
  // Restoring an earlier URL is the same state transition used by browser Back.
  assert.deepEqual(readWorkspace(workspaceHash(topic)),topic)
  assert.deepEqual(selectTopic(history,null),{...initial,historyScope:'all'})
})

test('history selected topic excludes stage diagnostics and other topic attempts', () => {
  const attempts=[
    { completedAt:'2026-10-07T10:00:00Z',result:{attemptId:'diagnostic',topicId:null}},
    { completedAt:'2026-10-07T11:00:00Z',result:{attemptId:'llm',topicId:'ai-foundations-llms'}},
    { completedAt:'2026-10-07T12:00:00Z',result:{attemptId:'tokens',topicId:'ai-foundations-tokens'}},
  ] as Completed[]
  const original=JSON.stringify(attempts)
  const state={...readWorkspace(''),topicId:'ai-foundations-llms',historyScope:'selected' as const}
  assert.deepEqual(historyAttempts(attempts,state).map(a=>a.result.attemptId),['llm'])
  assert.deepEqual(historyAttempts(attempts,{...state,historyScope:'all'}).map(a=>a.result.attemptId),['tokens','llm','diagnostic'])
  assert.deepEqual(historyAttempts(attempts,{...state,topicId:'unassessed'}),[])
  assert.deepEqual(historyAttempts(attempts,{...state,topicId:null}),[])
  assert.equal(JSON.stringify(attempts),original)
})

test('sidebar labels separate unassessed, sparse evidence and unavailable status', () => {
  assert.equal(sidebarStatus('Unknown'),'Unassessed')
  assert.equal(sidebarStatus('Insufficient Evidence'),'Insufficient evidence')
  assert.equal(sidebarStatus('Strong'),'Strong')
  assert.equal(sidebarStatus(undefined),'Status unavailable')
})

test('lesson URL survives refresh and topic changes return to summaries',()=>{
  const state=readWorkspace('#stage/stage-01?tab=overview&topic=ai-foundations-llms&lesson=1')
  assert.equal(state.lesson,true)
  assert.deepEqual(readWorkspace(workspaceHash(state)),state)
  assert.equal(selectTopic(state,'ai-foundations-tokens').lesson,undefined)
  assert.equal(selectTopic(state,null).lesson,undefined)
  assert.equal(readWorkspace('#stage/stage-01?tab=history&topic=ai-foundations-llms&lesson=1').lesson,undefined)
  assert.equal(readWorkspace('#stage/stage-01?lesson=1').lesson,undefined)
})

test('topic evidence has distinct labeled color tones without changing status interpretation',()=>{
 assert.equal(statusAppearance('Strong').tone,'strong')
 assert.equal(statusAppearance('Strong').icon,'✓')
 assert.equal(statusAppearance('Insufficient Evidence').label,'Insufficient evidence')
 assert.equal(statusAppearance('Unknown').label,'Unassessed')
 assert.equal(statusAppearance(undefined).label,'Status unavailable')
 assert.equal(new Set(['Strong','Developing','Needs Attention','Insufficient Evidence','Unknown'].map(status=>statusAppearance(status).tone)).size,5)
})
