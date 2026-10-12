import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import ts from 'typescript'

const src=new URL('../src/modules/assessment/',import.meta.url), out=new URL('../node_modules/.tmp/workspace-render/',import.meta.url)
mkdirSync(out,{recursive:true})
for(const module of ['Assessment','DiagnosticResults','Mastery','useMastery','progress','results-view','workspace']){
  const path=new URL(module+(['Assessment','DiagnosticResults','Mastery'].includes(module)?'.tsx':'.ts'),src)
  let code=ts.transpileModule(readFileSync(path,'utf8'),{compilerOptions:{jsx:ts.JsxEmit.ReactJSX,module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText
  code=code.replace(/from '(\.\/[^']+)'/g,"from '$1.mjs'")
  writeFileSync(new URL(module+'.mjs',out),code)
}
const readerSrc=new URL('../src/modules/learning-content/LessonReader.tsx',import.meta.url)
writeFileSync(new URL('LessonReader.mjs',out),ts.transpileModule(readFileSync(readerSrc,'utf8'),{compilerOptions:{jsx:ts.JsxEmit.ReactJSX,module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText)
const assessmentPath=new URL('Assessment.mjs',out)
writeFileSync(assessmentPath,readFileSync(assessmentPath,'utf8').replace('../learning-content/LessonReader','./LessonReader.mjs'))
const {default:Assessment}=await import(new URL('Assessment.mjs',out).href)
const curriculum=JSON.parse(readFileSync(new URL('../../backend/data/curriculum.json',import.meta.url),'utf8'))
const stage=curriculum.path.stages[0]
const originalWindow=globalThis.window,originalStorage=globalThis.localStorage
function render(hash:string){
  globalThis.window={location:{hash}} as unknown as Window & typeof globalThis
  globalThis.localStorage={getItem:()=>null} as unknown as Storage
  return renderToStaticMarkup(createElement(Assessment,{stage,onPosition:()=>{}}))
}

test('actual stage markup uses curriculum sidebar, one diagnostic and mobile selector',()=>{
  try{
    const html=render('#stage/stage-01?tab=overview')
    assert.ok(html.includes('Topics · 6'))
    assert.equal((html.match(/>Take stage diagnostic<\/button>/g)??[]).length,1)
    assert.ok(html.includes('Stage overview'))
    assert.ok(!html.includes('Whole-stage overview'))
    assert.ok(html.includes('id="stage-topic-select"'))
    for(const topic of stage.topics){assert.ok(html.includes(topic.title));assert.ok(html.includes(`value="${topic.id}"`))}
    assert.ok(html.includes('role="tablist"'))
    assert.ok(html.includes('aria-selected="true"'))
    assert.ok(!html.includes('Topics in this stage'))
  }finally{globalThis.window=originalWindow;globalThis.localStorage=originalStorage}
})

test('Assessments with no topic asks for selection and never shows every topic action',()=>{
  try{
    const html=render('#stage/stage-01?tab=assessments')
    assert.ok(html.includes('Choose a topic'))
    assert.equal((html.match(/>Take stage diagnostic<\/button>/g)??[]).length,1)
    assert.ok(!html.includes('>Topic reassessment</button>'))
  }finally{globalThis.window=originalWindow;globalThis.localStorage=originalStorage}
})

test('selected topic overview replaces main content and history has empty state',()=>{
  try{
    const topicHtml=render('#stage/stage-01?tab=overview&topic=ai-foundations-llms')
    assert.ok(topicHtml.includes('Language-model prediction, training and generation concepts.'))
    assert.ok(!topicHtml.includes('Tokenization, counting and usage budgets.'))
    assert.ok(topicHtml.includes('Latest topic result'))
    const historyHtml=render('#stage/stage-01?tab=history&topic=ai-foundations-llms&scope=selected')
    assert.ok(historyHtml.includes('All stage attempts'))
    assert.ok(historyHtml.includes('Selected topic'))
    assert.ok(historyHtml.includes('No saved attempts match this filter.'))
  }finally{globalThis.window=originalWindow;globalThis.localStorage=originalStorage}
})

test('lessons are reachable without progress and reader exposes loading recovery navigation',()=>{
  try{
    stage.topics[1].lessonStatus='available'
    const overview=render('#stage/stage-01?tab=overview&topic=ai-foundations-llms')
    assert.ok(overview.includes('Read lesson'))
    const reader=render('#stage/stage-01?tab=overview&topic=ai-foundations-llms&lesson=1')
    assert.ok(reader.includes('Loading lesson'))
    assert.ok(reader.includes('Back to topic summary'))
  }finally{globalThis.window=originalWindow;globalThis.localStorage=originalStorage}
})

test('published lesson markup includes examples, recap and safe descriptive resources',async()=>{
  const {LessonBody}=await import(new URL('LessonReader.mjs',out).href)
  const lessons=JSON.parse(readFileSync(new URL('../../backend/data/lessons/ai-foundations.json',import.meta.url),'utf8')).lessons
  for(const lesson of lessons){
    const html=renderToStaticMarkup(createElement(LessonBody,{lesson}))
    for(const label of ['Worked example','Common misconceptions','Recap','Further reading','Reading does not change mastery'])assert.ok(html.includes(label))
    assert.ok(html.includes('rel="noreferrer"'))
    assert.ok(html.includes(lesson.resources[0].url))
    assert.ok(!html.includes('<textarea'))
  }
})

test('evidence badges retain status labels and distinguish strong from unassessed and sparse evidence',async()=>{
 const {StatusBadge}=await import(new URL('Mastery.mjs',out).href)
 for(const [status,tone,label] of [['Strong','strong','Strong'],['Developing','developing','Developing'],['Needs Attention','attention','Needs Attention'],['Insufficient Evidence','insufficient','Insufficient evidence'],['Unknown','neutral','Unassessed']]){
  const html=renderToStaticMarkup(createElement(StatusBadge,{status}))
  assert.ok(html.includes(`evidence-${tone}`)&&html.includes(label))
  assert.ok(html.includes('aria-hidden="true"'))
 }
})

test('topic overview prioritizes lesson then practice then result then status and removes extra review panel',()=>{
 try{
  stage.topics[1].lessonStatus='available'
  const html=render('#stage/stage-01?tab=overview&topic=ai-foundations-llms')
  const positions=['>Read lesson<','<h2>Practice and reassessment</h2>','<h2>Latest topic result</h2>','Loading your topic status'].map(label=>html.indexOf(label))
  assert.ok(positions.every(p=>p>=0))
  assert.deepEqual([...positions].sort((a,b)=>a-b),positions)
  assert.ok(!html.includes('<h2>Optional review</h2>')&&!html.includes('<h2>Evidence'))
 }finally{globalThis.window=originalWindow;globalThis.localStorage=originalStorage}
})

test('topic status summary is readable while rules and starting snapshot are collapsed by default',async()=>{
 const {TopicEvidence}=await import(new URL('Mastery.mjs',out).href)
 const eligible={attemptId:'full',mode:'reassessment',completedAt:'2026-10-10T12:00:00Z',correct:17,total:20,percentage:85,bankVersion:'current'}
 const baseline={...eligible,attemptId:'baseline',mode:'diagnostic',correct:2,total:3,percentage:200/3}
 const topic={topicId:'ai-foundations-tokens',status:'Strong',baseline,latestReassessment:eligible,latestEligible:eligible,evidenceReason:'Old technical wording 60%/85% boundaries',observedDifference:85-200/3}
 const html=renderToStaticMarkup(createElement(TopicEvidence,{topic}))
 const summary=html.split('<details')[0]
 assert.ok(summary.includes('Your topic status')&&summary.includes('Strong'))
 assert.ok(summary.includes('17/20 correct · 85%')&&summary.includes('You can move on or review this topic whenever you like'))
 assert.ok(!summary.includes('85% or higher')&&!summary.includes('boundaries')&&!summary.includes('Starting diagnostic'))
 assert.ok(/<details class="/.test(html)&&!/<details[^>]*\bopen/.test(html))
 assert.ok(html.includes('How this status is determined')&&html.includes('2/3 correct · 67%'))
 assert.ok(html.includes('starting snapshot')&&html.includes('not a full topic assessment'))
 assert.ok(html.includes('Practice and diagnostics do not assign a mastery status'))
})

test('short reassessments preserve older status source and sparse results never imply mastery',async()=>{
 const {TopicEvidence}=await import(new URL('Mastery.mjs',out).href)
 const full={attemptId:'full',mode:'reassessment',completedAt:'2026-10-09T12:00:00Z',correct:18,total:20,percentage:90,bankVersion:'current'}
 const short={...full,attemptId:'short',completedAt:'2026-10-10T12:00:00Z',correct:2,total:10,percentage:20}
 const topic={topicId:'ai-foundations-tokens',status:'Strong',baseline:null,latestReassessment:short,latestEligible:full,evidenceReason:'server explanation',observedDifference:null}
 const html=renderToStaticMarkup(createElement(TopicEvidence,{topic})).split('<details')[0]
 assert.ok(html.includes('18/20 correct · 90%'))
 assert.ok(html.includes('2/10 correct · 20%')&&html.includes('Your status still uses the full reassessment'))
 const insufficient=renderToStaticMarkup(createElement(TopicEvidence,{topic:{...topic,status:'Insufficient Evidence',latestEligible:null}}))
 assert.ok(insufficient.includes('Complete a reassessment with at least 20 questions'))
 assert.ok(!insufficient.includes('Based on your latest full reassessment'))
 const unknown=renderToStaticMarkup(createElement(TopicEvidence,{topic:{...topic,status:'Unknown',latestReassessment:null,latestEligible:null}}))
 assert.ok(unknown.includes('Unassessed')&&unknown.includes('No starting diagnostic result is available'))
 assert.ok(!/\d+%/.test(unknown.split('<details')[0]))
})

test('historical starting snapshot remains inspectable without influencing current status',async()=>{
 const {TopicEvidence}=await import(new URL('Mastery.mjs',out).href)
 const historical={attemptId:'old-baseline',mode:'diagnostic',completedAt:'2026-10-07T12:00:00Z',correct:1,total:3,percentage:100/3,bankVersion:'old'}
 const topic={topicId:'ai-foundations-tokens',status:'Unknown',baseline:null,latestReassessment:null,latestEligible:null,evidenceReason:'server explanation',observedDifference:null}
 const html=renderToStaticMarkup(createElement(TopicEvidence,{topic,historicalBaseline:historical}))
 assert.ok(!html.split('<details')[0].includes('1/3'))
 assert.ok(html.includes('1/3 correct · 33%'))
 assert.ok(html.includes('earlier question set and does not determine your current status'))
})
