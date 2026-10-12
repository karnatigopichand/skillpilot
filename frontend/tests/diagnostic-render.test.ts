import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import ts from 'typescript'

// Render the real TSX component without requiring browser control or a new dependency.
const sourceDir = new URL('../src/modules/assessment/', import.meta.url)
const outputDir = new URL('../node_modules/.tmp/results-render/', import.meta.url)
mkdirSync(outputDir, { recursive: true })
for (const [source, output] of [['results-view.ts', 'results-view.mjs'], ['DiagnosticResults.tsx', 'DiagnosticResults.mjs']]) {
  const code = ts.transpileModule(readFileSync(new URL(source, sourceDir), 'utf8'), { compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText.replace("from './results-view'", "from './results-view.mjs'")
  writeFileSync(new URL(output, outputDir), code)
}
const { default: DiagnosticResults } = await import(new URL('DiagnosticResults.mjs', outputDir).href)

test('actual rendered results contain labeled donut, table and default All tabs', () => {
  const bank = JSON.parse(readFileSync(new URL('../../backend/data/question-banks/ai-foundations.sample.json', import.meta.url), 'utf8'))
  const questions = bank.questions.map(q => ({ id: q.id, topicId: q.topicId, conceptId: q.conceptId, difficulty: q.difficulty, prompt: q.prompt, options: q.options }))
  const feedback = bank.questions.map((q, index) => { const isCorrect = ![5, 9, 10, 11].includes(index); return { questionId: q.id, isCorrect, selectedOptionId: isCorrect ? q.correctOptionId : q.options.find(o => o.id !== q.correctOptionId).id, correctOptionId: q.correctOptionId, explanation: q.explanation, reference: q.reference } })
  const topicIds = [...new Set(questions.map(q => q.topicId))]
  const result = { mode: 'diagnostic', correct: 14, total: 18, feedback, topics: topicIds.map(topicId => ({ topicId, correct: feedback.filter((f, i) => questions[i].topicId === topicId && f.isCorrect).length, total: 3 })) }
  const html = renderToStaticMarkup(createElement(DiagnosticResults, { completed: { draft: { delivery: { questions } }, result }, saved: true, onBack: () => {} }))
  assert.ok(html.includes('78%'))
  assert.ok(html.includes('14 correct and 4 incorrect out of 18'))
  assert.ok(html.includes('<table'))
  for (const column of ['Topic', 'Correct / Total', 'Percentage', 'Answer result', 'Mastery evidence']) assert.ok(html.includes(column))
  assert.ok(html.includes('All (18)'))
  assert.ok(html.includes('Correct (14)'))
  assert.ok(html.includes('Incorrect (4)'))
  assert.match(html, /role="tab" aria-selected="true"[^>]*>All \(18\)/)
  assert.equal((html.match(/Insufficient evidence for mastery/g) ?? []).length, 6)
  assert.equal((html.match(/Your answer:/g) ?? []).length, 18)
  assert.equal((html.match(/Correct answer:/g) ?? []).length, 18)
  assert.ok(html.includes('Question 6.'))
  assert.ok(html.includes('Show all topics'))
  assert.ok(html.includes('All correct') && html.includes('Some incorrect') && html.includes('All incorrect'))
})

test('practice and reassessment use the diagnostic chart table and review layout with honest evidence',()=>{
 const bank=JSON.parse(readFileSync(new URL('../../backend/data/question-banks/ai-foundations.50.json',import.meta.url),'utf8'))
 const records=bank.questions.filter(q=>q.topicId==='ai-foundations-tokens').slice(0,20)
 const questions=records.map(q=>({id:q.id,topicId:q.topicId,conceptId:q.conceptId,difficulty:q.difficulty,prompt:q.prompt,options:q.options}))
 const feedback=records.map((q,index)=>({questionId:q.id,isCorrect:index<14,selectedOptionId:index<14?q.correctOptionId:q.options.find(o=>o.id!==q.correctOptionId).id,correctOptionId:q.correctOptionId,explanation:q.explanation,reference:q.reference}))
 let chart:string|undefined
 for(const mode of ['diagnostic','practice','reassessment']){
  const result={mode,correct:14,total:20,feedback,topics:[{topicId:'ai-foundations-tokens',correct:14,total:20}]}
  const html=renderToStaticMarkup(createElement(DiagnosticResults,{completed:{draft:{delivery:{questions}},result},saved:true,onBack:()=>{}}))
  assert.ok(html.includes(mode[0].toUpperCase()+mode.slice(1)+' results'))
  assert.ok(html.includes('70% correct; 14 correct and 6 incorrect out of 20'))
  assert.ok(html.includes('All (20)')&&html.includes('Correct (14)')&&html.includes('Incorrect (6)'))
  assert.ok(html.includes('Show all topics')&&html.includes('<table'))
  assert.ok(html.includes('Question 20.')&&html.includes('Your answer:')&&html.includes('Correct answer:'))
  const svg=html.match(/<svg[\s\S]*?<\/svg>/)![0]
  if(chart)assert.equal(svg,chart);else chart=svg
  if(mode==='practice')assert.ok(html.includes('Practice — does not update mastery'))
  if(mode==='reassessment')assert.ok(html.includes('Qualifying reassessment — see topic evidence for current mastery'))
 }
 const short=renderToStaticMarkup(createElement(DiagnosticResults,{completed:{draft:{delivery:{questions:questions.slice(0,10)}},result:{mode:'reassessment',correct:10,total:10,feedback:feedback.slice(0,10),topics:[{topicId:'ai-foundations-tokens',correct:10,total:10}]}},saved:true,onBack:()=>{}}))
 assert.ok(short.includes('Insufficient evidence for mastery'))
 assert.ok(!short.includes('Qualifying reassessment —'))
})
