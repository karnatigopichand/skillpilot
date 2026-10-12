import {test} from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync,mkdirSync,writeFileSync} from 'node:fs'
import {createElement} from 'react'
import {renderToStaticMarkup} from 'react-dom/server'
import ts from 'typescript'
import {emptyProgress} from '../src/modules/assessment/progress.ts'
import {dashboardActivity} from '../src/modules/dashboard/activity.ts'
const out=new URL('../node_modules/.tmp/dashboard-render/',import.meta.url)
mkdirSync(out,{recursive:true})
for(const [name,path] of [['Dashboard','../src/modules/dashboard/Dashboard.tsx'],['overview-navigation','../src/modules/dashboard/overview-navigation.ts'],['activity','../src/modules/dashboard/activity.ts'],['workspace','../src/modules/assessment/workspace.ts']]){
 const code=ts.transpileModule(readFileSync(new URL(path,import.meta.url),'utf8'),{compilerOptions:{jsx:ts.JsxEmit.ReactJSX,module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText.replace("'./activity'","'./activity.mjs'").replace("'./overview-navigation'","'./overview-navigation.mjs'").replace("'../assessment/workspace'","'./workspace.mjs'")
 writeFileSync(new URL(name+'.mjs',out),code)
}
const {default:Dashboard}=await import(new URL('Dashboard.mjs',out).href)
const stage=JSON.parse(readFileSync(new URL('../../backend/data/curriculum.json',import.meta.url),'utf8')).path.stages[0]
const base={progress:emptyProgress(),blocked:false,error:'',unsaved:false,bankVersion:'sample-0.1',mastery:{loading:false,plan:{topics:[],recommendations:[],optionalReview:[]}}}
const render=(snapshot:unknown)=>renderToStaticMarkup(createElement(Dashboard,{snapshot,stage,onOpen:()=>{}}))

test('empty dashboard has learning entry without fabricated evidence',()=>{
 const html=render(base)
 assert.ok(html.includes('Begin your learning journey'))
 assert.ok(html.includes('browse a topic lesson first'))
 assert.ok(html.includes('No completed assessments yet'))
 assert.deepEqual(dashboardActivity(base.progress),{count:0,latest:null})
})
test('dashboard shows actual latest attempt and does not treat activity as mastery',()=>{
 const snapshot=structuredClone(base)
 const attempt=(id:string,completedAt:string)=>({completedAt,result:{attemptId:id,mode:'diagnostic',topicId:null,correct:14,total:18,percentage:14/18*100,bankVersion:'sample-0.1'}})
 // Display projection fixture: full persisted validation is separately exercised with real draft/result contracts.
 snapshot.progress.completedAttempts=[attempt('new','2026-10-07T12:00:00Z'),attempt('old','2026-10-07T14:00:00+03:00')] as typeof snapshot.progress.completedAttempts
 const original=JSON.stringify(snapshot.progress)
 assert.equal(dashboardActivity(snapshot.progress).latest?.result.attemptId,'new')
 const html=render(snapshot)
 for(const label of ['2 completed assessments','14/18','78%','View latest results','View history','Activity is not mastery'])assert.ok(html.includes(label))
 assert.equal(JSON.stringify(snapshot.progress),original)
})
test('dashboard uses server recommendation and exposes blocked/error recovery honestly',()=>{
 const snapshot=structuredClone(base)
 snapshot.mastery.plan.recommendations=[{topicId:'ai-foundations-llms',reason:'Server evidence reason',action:'practice'}] as typeof snapshot.mastery.plan.recommendations
 assert.ok(render(snapshot).includes('Continue with Large Language Models'))
 assert.ok(render(snapshot).includes('Server evidence reason'))
 snapshot.mastery.plan.recommendations=[{topicId:'ai-foundations-llms',reason:'Take baseline first',action:'diagnostic'}] as typeof snapshot.mastery.plan.recommendations
 assert.ok(render(snapshot).includes('Take stage diagnostic'))
 const blocked=render({...base,blocked:true,error:'Corrupt storage'})
 assert.ok(blocked.includes('Open progress recovery'))
 assert.ok(!blocked.includes('Begin your learning journey'))
 const loading=render({...base,mastery:{loading:true}})
 assert.ok(loading.includes('Evaluating saved evidence'))
 assert.ok(!loading.includes('Continue with'))
 assert.ok(render({...base,mastery:{loading:false,error:'Request failed'}}).includes('Open evidence recovery'))
})

test('dashboard actions target exact saved attempt, stage history and recommended topic URLs',()=>{
 const snapshot=structuredClone(base)
 snapshot.progress.completedAttempts=[{completedAt:'2026-10-07T12:00:00Z',result:{attemptId:'saved-id',mode:'practice',topicId:'ai-foundations-llms',correct:2,total:3,percentage:200/3,bankVersion:'sample-0.1'}}] as typeof snapshot.progress.completedAttempts
 snapshot.mastery.plan.recommendations=[{topicId:'ai-foundations-tokens',reason:'Review tokens',action:'practice'}] as typeof snapshot.mastery.plan.recommendations
 const routes:string[]=[]
 const tree=Dashboard({snapshot,stage,onOpen:(hash:string)=>routes.push(hash)})
 const buttons=new Map<string,()=>void>()
 function visit(node:unknown):void{
   if(Array.isArray(node)){node.forEach(visit);return}
   if(!node||typeof node!=='object'||!('props' in node))return
   const el=node as {type:unknown;props:{children?:unknown;onClick?:()=>void}}
   if(el.type==='button'&&el.props.onClick)buttons.set(Array.isArray(el.props.children)?el.props.children.join(''):String(el.props.children),el.props.onClick)
   visit(el.props.children)
 }
 visit(tree)
 buttons.get('View latest results')!()
 buttons.get('View history')!()
 buttons.get('Continue with Tokens')!()
 assert.ok(routes[0].includes('attempt=saved-id'))
 assert.ok(routes[0].includes('topic=ai-foundations-llms'))
 assert.equal(routes[1],'#stage/stage-01?tab=history')
 assert.equal(routes[2],'#stage/stage-01?tab=overview&topic=ai-foundations-tokens')
})

test('latest result routes to its own stage while another stage has an active draft',()=>{
 const stages=JSON.parse(readFileSync(new URL('../../backend/data/curriculum.json',import.meta.url),'utf8')).path.stages
 const snapshot={...structuredClone(base),stageId:'stage-04'}
 snapshot.progress.completedAttempts=[{completedAt:'2026-10-08T12:00:00Z',result:{stageId:'stage-02',attemptId:'stage-two-result',mode:'diagnostic',topicId:null,correct:14,total:17,percentage:1400/17,bankVersion:'stage-02-50-v1'}}] as typeof snapshot.progress.completedAttempts
 const routes:string[]=[]
 const tree=Dashboard({snapshot,stage:stages[3],stages,onOpen:(hash:string)=>routes.push(hash)})
 function visit(node:unknown):void{
  if(Array.isArray(node)){node.forEach(visit);return}
  if(!node||typeof node!=='object'||!('props' in node))return
  const el=node as {type:unknown;props:{children?:unknown;onClick?:()=>void}}
  if(el.type==='button'&&el.props.children==='View latest results')el.props.onClick!()
  visit(el.props.children)
 }
 visit(tree)
 assert.equal(routes[0],'#stage/stage-02?tab=history&attempt=stage-two-result')
 const html=renderToStaticMarkup(createElement(Dashboard,{snapshot:{...snapshot,stageId:'stage-02'},stage:stages[3],stages,onOpen:()=>{}}))
 assert.ok(html.includes('Evaluating saved evidence'))
})

test('overview has four ordered panels and collapsible navigation in every storage state',()=>{
 for(const snapshot of [base,null,{...base,blocked:true,error:'Storage failed'}]){
  const html=render(snapshot)
  const ids=['overview-welcome','overview-roadmap','overview-next','overview-latest']
  const positions=ids.map(id=>html.indexOf(`id="${id}"`))
  assert.ok(positions.every(i=>i>=0))
  assert.deepEqual([...positions].sort((a,b)=>a-b),positions)
  assert.equal((html.match(/<section /g)??[]).length,4)
  assert.ok(html.includes('<details open=""'))
  assert.ok(html.includes('aria-label="Overview sections"'))
  for(const id of ids){assert.ok(html.includes(`href="#overview?section=${id}"`));assert.ok(html.includes(`id="${id}" tabindex="-1"`))}
 }
})

test('quick navigation focuses and scrolls to its panel without writing browser history',async()=>{
 const {jumpToSection}=await import('../src/modules/dashboard/overview-navigation.ts')
 const original=globalThis.document
 const calls:unknown[]=[]
 globalThis.document={getElementById:(id:string)=>{assert.equal(id,'overview-next');return {focus:(options:unknown)=>calls.push(['focus',options]),scrollIntoView:(options:unknown)=>calls.push(['scroll',options])}}} as unknown as Document
 try{
  jumpToSection('overview-next')
  assert.deepEqual(calls,[['focus',{preventScroll:true}],['scroll',{block:'start'}]])
 }finally{globalThis.document=original}
})
