import {test} from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync,mkdirSync,writeFileSync} from 'node:fs'
import {createElement} from 'react'
import {renderToStaticMarkup} from 'react-dom/server'
import ts from 'typescript'
const out=new URL('../node_modules/.tmp/roadmap-render/',import.meta.url)
mkdirSync(out,{recursive:true})
for(const [name,path] of [['RoadmapView','../src/modules/learning-paths/RoadmapView.tsx'],['overview-navigation','../src/modules/dashboard/overview-navigation.ts']]){
 const code=ts.transpileModule(readFileSync(new URL(path,import.meta.url),'utf8'),{compilerOptions:{jsx:ts.JsxEmit.ReactJSX,module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText.replace("'../dashboard/overview-navigation'","'./overview-navigation.mjs'")
 writeFileSync(new URL(name+'.mjs',out),code)
}
const {default:RoadmapView}=await import(new URL('RoadmapView.mjs',out).href)
const stages=JSON.parse(readFileSync(new URL('../../backend/data/curriculum.json',import.meta.url),'utf8')).path.stages
test('roadmap stage strip and section links use all actual stages without fabricated completion',()=>{
 const html=renderToStaticMarkup(createElement(RoadmapView,{stages,onOpen:()=>{}}))
 assert.ok(html.includes('aria-label="7-stage path"'))
 assert.ok(html.includes('aria-label="Roadmap stage sections"'))
 assert.ok(html.indexOf('roadmap-stage-strip')<html.indexOf('roadmap-workspace'))
 assert.equal((html.match(/class="roadmap-step-number"/g)??[]).length,7)
 assert.ok(!html.includes('role="progressbar"')&&!html.includes('aria-valuenow')&&!html.includes('Completed'))
 for(const stage of stages){
  assert.equal((html.match(new RegExp(`href="#roadmap\\?stage=${stage.id}"`,'g'))??[]).length,2)
  assert.ok(html.includes(`id="roadmap-${stage.id}" tabindex="-1"`))
  assert.ok(html.includes(`id="open-${stage.id}"`))
  assert.ok(html.includes(`href="#stage/${stage.id}?tab=overview"`))
  assert.ok(html.includes(`${stage.topics.length} topics · ${stage.diagnosticStatus==='available'?'Diagnostic available':'Diagnostic unavailable'}`))
 }
 assert.ok(html.includes('for="roadmap-stage-selector"')&&html.includes('Jump to a stage'))
 assert.equal((html.match(/<option value="stage-/g)??[]).length,7)
})
test('roadmap availability remains honest for planned content',()=>{
 const pending=structuredClone(stages)
 pending[0].diagnosticStatus='planned'
 pending[0].topics=[]
 const html=renderToStaticMarkup(createElement(RoadmapView,{stages:pending,onOpen:()=>{}}))
 assert.ok(html.includes('Topic catalog pending review'))
 pending[0].topics=stages[0].topics
 const withTopics=renderToStaticMarkup(createElement(RoadmapView,{stages:pending,onOpen:()=>{}}))
 assert.ok(withTopics.includes('6 topics · Diagnostic unavailable'))
})
