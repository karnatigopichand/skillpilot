import { useState } from 'react'
import type { Stage } from './catalog'
import { jumpToSection } from '../dashboard/overview-navigation'

export default function RoadmapView({stages,onOpen}: {stages: Stage[]; onOpen: (stageId: string) => void}) {
  const [selected,setSelected]=useState<string|null>(null)
  function jump(stageId: string) {
    setSelected(stageId)
    jumpToSection(`roadmap-${stageId}`)
  }
  return <>
    <section className="panel roadmap-path" aria-labelledby="roadmap-path-heading">
      <h2 id="roadmap-path-heading">Your path · {stages.length} stages</h2>
      <p className="text-sm text-slate-500 mb-4">Choose a stage. Start anywhere, at your pace.</p>
      <nav aria-label={`${stages.length}-stage path`}>
        <ol className="roadmap-stage-strip">
          {stages.map(stage=><li key={stage.id}><a href={`#roadmap?stage=${stage.id}`} aria-current={selected===stage.id?'location':undefined} onClick={event=>{event.preventDefault();jump(stage.id)}}><span className="roadmap-step-number">{stage.order}</span><span>{stage.title}</span></a></li>)}
        </ol>
      </nav>
    </section>
    <div className="roadmap-workspace">
      <aside className="roadmap-sidebar">
        <details open className="overview-navigation roadmap-desktop-navigation">
          <summary className="font-semibold">Jump to a stage</summary>
          <nav aria-label="Roadmap stage sections">
            {stages.map(stage=><a key={stage.id} href={`#roadmap?stage=${stage.id}`} aria-current={selected===stage.id?'location':undefined} onClick={event=>{event.preventDefault();jump(stage.id)}}>{stage.order}. {stage.title}</a>)}
          </nav>
        </details>
        <div className="roadmap-mobile-navigation panel">
          <label htmlFor="roadmap-stage-selector" className="block font-semibold mb-2">Jump to a stage</label>
          <select id="roadmap-stage-selector" className="w-full bg-white border border-slate-300 rounded-lg p-3" value={selected??''} onChange={event=>{if(event.target.value)jump(event.target.value)}}>
            <option value="">Choose a stage</option>
            {stages.map(stage=><option key={stage.id} value={stage.id}>{stage.order}. {stage.title}</option>)}
          </select>
        </div>
      </aside>
      <div className="flex flex-col gap-3 min-w-0">
        {stages.map(stage=><section className="stage-card roadmap-stage-card" key={stage.id} aria-labelledby={`roadmap-${stage.id}`}>
          <span className="stage-number" aria-hidden="true">{String(stage.order).padStart(2,'0')}</span>
          <div className="min-w-0 flex-1">
            <h2 id={`roadmap-${stage.id}`} tabIndex={-1} className="text-lg"><a className="text-blue-700 hover:underline" href={`#stage/${stage.id}?tab=overview`} onClick={event=>{event.preventDefault();onOpen(stage.id)}}>{stage.title}</a></h2>
            <p className="text-sm text-slate-500 mb-3">{stage.summary}</p>
            <span className="tag">{stage.topics.length?`${stage.topics.length} topics · ${stage.diagnosticStatus==='available'?'Diagnostic available':'Diagnostic unavailable'}`:'Topic catalog pending review'}</span>
            <div className="mt-4"><button id={`open-${stage.id}`} className="primary" onClick={()=>onOpen(stage.id)}>Open {stage.title} <span aria-hidden="true">→</span></button></div>
          </div>
        </section>)}
      </div>
    </div>
  </>
}
