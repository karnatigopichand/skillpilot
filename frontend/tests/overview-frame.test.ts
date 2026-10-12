import {test} from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync,mkdirSync,writeFileSync} from 'node:fs'
import {createElement} from 'react'
import {renderToStaticMarkup} from 'react-dom/server'
import ts from 'typescript'
const out=new URL('../node_modules/.tmp/overview-frame/',import.meta.url)
mkdirSync(out,{recursive:true})
const paths={RoadmapView:'../src/modules/learning-paths/RoadmapView.tsx',App:'../src/App.tsx',Dashboard:'../src/modules/dashboard/Dashboard.tsx',activity:'../src/modules/dashboard/activity.ts',workspace:'../src/modules/assessment/workspace.ts',catalog:'../src/modules/learning-paths/catalog.ts','overview-navigation':'../src/modules/dashboard/overview-navigation.ts'}
for(const [name,path] of Object.entries(paths)){
 let code=ts.transpileModule(readFileSync(new URL(path,import.meta.url),'utf8'),{compilerOptions:{jsx:ts.JsxEmit.ReactJSX,module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText
 for(const module of [...Object.keys(paths),'Assessment'])code=code.replace(new RegExp(`from '[^']*/${module}'`,'g'),`from './${module}.mjs'`)
 writeFileSync(new URL(name+'.mjs',out),code)
}
writeFileSync(new URL('Assessment.mjs',out),'export default function Assessment(){return null}')
const {default:App}=await import(new URL('App.mjs',out).href)
test('overview keeps its brief guide and the old flow indicator is absent from every page',()=>{
 const oldWindow=globalThis.window,oldStorage=globalThis.localStorage
 try{
  globalThis.localStorage={getItem:()=>null} as unknown as Storage
  globalThis.window={location:{hash:'#overview'}} as unknown as Window & typeof globalThis
  const overview=renderToStaticMarkup(createElement(App))
  assert.ok(overview.includes('Choose a stage, take a diagnostic to find gaps'))
  assert.ok(overview.includes('read lessons before a diagnostic'))
  assert.ok(!overview.includes('aria-label="Learning journey"'))
  globalThis.window={location:{hash:'#stage/stage-02'}} as unknown as Window & typeof globalThis
  const stage=renderToStaticMarkup(createElement(App))
  assert.ok(!stage.includes('aria-label="Learning journey"'))
  globalThis.window={location:{hash:'#roadmap'}} as unknown as Window & typeof globalThis
  const roadmap=renderToStaticMarkup(createElement(App))
  assert.ok(!roadmap.includes('aria-label="Learning journey"'))
 }finally{globalThis.window=oldWindow;globalThis.localStorage=oldStorage}
})
