import {test} from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {complete,emptyProgress,restore,saveProgress} from '../src/modules/assessment/progress.ts'
import type {Draft,Result,Progress} from '../src/modules/assessment/progress.ts'
import {workspaceHash,readWorkspace,historyAttempts} from '../src/modules/assessment/workspace.ts'
import {diagnosticView,filterReview} from '../src/modules/assessment/results-view.ts'
const curriculum=JSON.parse(readFileSync(new URL('../../backend/data/curriculum.json',import.meta.url),'utf8'))
function attempt(stageId:string,id:string,count=1) {
 const stage=curriculum.path.stages.find(s=>s.id===stageId)
 const topics=stage.topics
 const questions=Array.from({length:count},(_,i)=>({id:`${id}-q${i}`,topicId:topics[i%topics.length].id,conceptId:'test',difficulty:'easy',prompt:'Fixture only',options:['a','b','c','d'].map(id=>({id,text:id}))}))
 const draft:Draft={delivery:{attemptId:id,mode:'diagnostic',topicId:null,stageId,bankVersion:stageId+'-test',cycleId:null,receipt:'test-receipt',issuedAt:1,expiresAt:9999999999,questionCount:count,bankSize:100,warnings:[],questions},answers:Object.fromEntries(questions.map(q=>[q.id,'a']))}
 const result:Result={attemptId:id,mode:'diagnostic',topicId:null,stageId,bankVersion:draft.delivery.bankVersion,cycleId:null,correct:count,total:count,percentage:100,topics:topics.flatMap(t=>{const total=questions.filter(q=>q.topicId===t.id).length;return total?[{topicId:t.id,correct:total,total}]:[]}),feedback:questions.map(q=>({questionId:q.id,selectedOptionId:'a',correctOptionId:'a',isCorrect:true,explanation:'Fixture',reference:{url:'https://example.com',title:'Fixture'}}))}
 return {draft,result}
}
test('legacy migration preserves completions baseline draft exposure and cycles without writing',()=>{
 const a=attempt('stage-01','first')
 const completed=complete(emptyProgress(),a.draft,a.result,'2026-10-07T12:00:00Z')
 const pending=attempt('stage-01','draft').draft
 const legacy={...completed,schemaVersion:1,curriculumVersion:'2026-10-07.1',activeAttempt:pending} as Progress
 delete legacy.initialDiagnosticByStage
 const raw=JSON.stringify(legacy)
 const migrated=restore(raw)
 assert.equal(migrated.schemaVersion,2)
 assert.deepEqual(migrated.completedAttempts,legacy.completedAttempts)
 assert.deepEqual(migrated.activeAttempt,pending)
 assert.deepEqual(migrated.diagnosticExposure,legacy.diagnosticExposure)
 assert.deepEqual(migrated.topicCycles,legacy.topicCycles)
 assert.deepEqual(migrated.initialDiagnosticByStage,{'stage-01':'first'})
 assert.deepEqual(restore(JSON.stringify(migrated)),migrated)
 let stored=raw
 const failing={getItem:()=>stored,setItem:()=>{throw new Error('quota')}}
 assert.throws(()=>saveProgress(failing,migrated,raw))
 assert.equal(stored,raw)
 const invalid=JSON.parse(raw);invalid.completedAttempts[0].result.total=99
 assert.throws(()=>restore(JSON.stringify(invalid)))
})
test('all-stage baselines stay independent and a 23-question diagnostic restores',()=>{
 let p=emptyProgress()
 for(const stage of curriculum.path.stages){
  const a=attempt(stage.id,stage.id+'-first',stage.id==='stage-04'?23:14)
  p=complete(p,a.draft,a.result,'2026-10-07T13:00:00Z')
  const later=attempt(stage.id,stage.id+'-later')
  p=complete(p,later.draft,later.result,'2026-10-07T14:00:00Z')
 }
 const restored=restore(JSON.stringify(p))
 assert.equal(restored.completedAttempts.length,14)
 for(const stage of curriculum.path.stages)assert.equal(restored.initialDiagnosticByStage?.[stage.id],stage.id+'-first')
 assert.equal(restored.initialDiagnosticAttemptId,'stage-01-first')
 const bad=structuredClone(p);bad.initialDiagnosticByStage!['stage-02']='stage-01-first'
 assert.throws(()=>restore(JSON.stringify(bad)))
 const foreign=attempt('stage-02','foreign');foreign.draft.delivery.questions[0].topicId='ai-foundations-tokens'
 assert.throws(()=>complete(emptyProgress(),foreign.draft,foreign.result))
})
test('stage-aware URLs and topic correctness filters preserve real mappings and numbering',()=>{
 for(const stage of curriculum.path.stages){
  const w={tab:'history',topicId:stage.topics[0].id,attemptId:'saved',historyScope:'selected'} as const
  const hash=workspaceHash(w,stage.id)
  assert.ok(hash.startsWith('#stage/'+stage.id+'?'))
  assert.deepEqual(readWorkspace(hash),w)
  const a=attempt(stage.id,'review',3*stage.topics.length+2)
  const p=complete(emptyProgress(),a.draft,a.result)
  const view=diagnosticView(p.completedAttempts[0],stage.topics)
  assert.equal(view.topics.length,stage.topics.length)
  assert.equal(view.topics.reduce((n,t)=>n+t.total,0),a.result.total)
  const filtered=filterReview(view.review,stage.topics[0].id,'correct')
  assert.ok(filtered.every(q=>q.question.topicId===stage.topics[0].id&&q.answer.isCorrect))
  assert.deepEqual(filtered.map(q=>q.number),[1,1+stage.topics.length,1+2*stage.topics.length,1+3*stage.topics.length])
  assert.deepEqual(filterReview(view.review,stage.topics[0].id,'incorrect'),[])
  assert.equal(historyAttempts(p.completedAttempts,w).length,0)
 }
})
