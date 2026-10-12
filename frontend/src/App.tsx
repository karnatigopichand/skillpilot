import RoadmapView from './modules/learning-paths/RoadmapView'
import { useEffect, useRef, useState } from 'react'
import { parseRoadmap } from './modules/learning-paths/catalog'
import type { Roadmap } from './modules/learning-paths/catalog'
import { dashboardActivity } from './modules/dashboard/activity'
import Dashboard from './modules/dashboard/Dashboard'
import type { ProgressSnapshot } from './modules/dashboard/Dashboard'
import Assessment from './modules/assessment/Assessment'

type View = { page: 'overview' | 'roadmap' } | { page: 'stage'; id: string }
function readView(hash: string): View {
  const path = hash.split('?')[0]
  if (path.startsWith('#stage/')) return { page: 'stage', id: path.slice(7) }
  return { page: path === '#roadmap' ? 'roadmap' : 'overview' }
}

type Load = { status: 'loading' } | { status: 'error'; message: string } | { status: 'ready'; data: Roadmap }

function savedAttemptStage(): string | null {
  try {
    const saved = JSON.parse(localStorage.getItem('skillpilot.progress.v1') ?? 'null')
    if (!saved?.activeAttempt) return null
    const id = saved.activeAttempt.delivery?.stageId
    return typeof id === 'string' && /^stage-0[1-7]$/.test(id) ? id : 'stage-01'
  } catch { return 'stage-01' }
}

export default function App() {
  const [view, setView] = useState<View>(() => {
    const id = savedAttemptStage()
    return id ? {page: 'stage', id} : readView(window.location.hash)
  })
  const [load, setLoad] = useState<Load>({ status: 'loading' })
  const [request, setRequest] = useState(0)
  const [snapshot,setSnapshot]=useState<ProgressSnapshot|null>(null)
  const heading = useRef<HTMLHeadingElement>(null)
  const returnStage = useRef<string | null>(null)
  const moved = useRef(false)
  const lastRoute = useRef(window.location.hash)

  useEffect(() => {
    const controller = new AbortController()
    fetch('/api/roadmap', { signal: controller.signal })
      .then(response => { if (!response.ok) throw new Error('The roadmap could not be loaded. Check that the backend is running and retry.'); return response.json() })
      .then(data => { if (!controller.signal.aborted) setLoad({ status: 'ready', data: parseRoadmap(data) }) })
      .catch(error => { if (!controller.signal.aborted) setLoad({ status: 'error', message: error instanceof Error ? error.message : 'The roadmap could not be loaded.' }) })
    return () => controller.abort()
  }, [request])

  useEffect(() => {
    if (!moved.current) return
    const target = view.page === 'roadmap' && returnStage.current ? document.getElementById(`open-${returnStage.current}`) : null
    if (target) { target.focus(); returnStage.current = null } else heading.current?.focus()
  }, [view, load.status])

  useEffect(() => {
    const activeStage = savedAttemptStage()
    if (!window.location.hash || activeStage) { const hash = activeStage ? '#stage/' + activeStage + '?tab=assessments' : '#overview'; window.history.replaceState(null, '', hash); lastRoute.current = hash }
    const changed = () => {
      const next = readView(window.location.hash)
      if (!(next.page === 'stage' && lastRoute.current.split('?')[0] === '#stage/' + next.id) && !window.dispatchEvent(new Event('skillpilot:leave-assessment', { cancelable: true }))) { window.history.pushState(null, '', lastRoute.current); return }
      lastRoute.current = window.location.hash; moved.current = true; setView(next)
    }
    window.addEventListener('popstate', changed); window.addEventListener('hashchange', changed)
    return () => { window.removeEventListener('popstate', changed); window.removeEventListener('hashchange', changed) }
  }, [])

  function navigate(next: View) {
    if (!(next.page === 'stage' && lastRoute.current.split('?')[0] === '#stage/' + next.id) && !window.dispatchEvent(new Event('skillpilot:leave-assessment', { cancelable: true }))) return
    const hash = next.page === 'stage' ? `#stage/${next.id}?tab=overview` : `#${next.page}`
    window.history.pushState(null, '', hash); lastRoute.current = hash
    moved.current = true; setView(next); window.dispatchEvent(new Event('popstate'))
  }
  const stage = load.status === 'ready' && view.page === 'stage' ? load.data.path.stages.find(item => item.id === view.id) : undefined
  const recentStageId = snapshot?.progress.activeAttempt?.delivery.stageId ?? (snapshot ? dashboardActivity(snapshot.progress).latest?.result.stageId : undefined) ?? 'stage-01'
  const dashboardStage = load.status === 'ready' ? load.data.path.stages.find(s => s.id === recentStageId) ?? load.data.path.stages[0] : undefined
  const title = view.page === 'overview' ? 'Start with what you know.' : view.page === 'roadmap' ? 'Agentic AI Engineering' : stage ? `${stage.title} — Stage ${stage.order} of ${load.status === 'ready' ? load.data.path.stages.length : 7}` : 'This stage is not available'

  return <>
    <header className="bg-white border-b border-slate-200"><div className="max-w-5xl mx-auto px-5 py-5 flex items-center justify-between gap-4 flex-wrap">
      <a href="#" onClick={event => { event.preventDefault(); navigate({ page: 'overview' }) }} className="brand"><span className="brand-mark">S</span>SkillPilot</a>
      <span className="text-sm text-slate-500">Your personal learning space</span>
    </div></header>
    <nav className="bg-white border-b border-slate-200" aria-label="Main navigation"><div className="max-w-5xl mx-auto px-5 py-2 flex gap-2 flex-wrap">
      {(['overview', 'roadmap'] as const).map(page => <button key={page} className={`nav-button ${view.page === page || page === 'roadmap' && view.page === 'stage' ? 'selected' : ''}`} aria-current={view.page === page || page === 'roadmap' && view.page === 'stage' ? 'page' : undefined} onClick={() => { returnStage.current = null; navigate({ page }) }}>{page === 'overview' ? 'Overview' : 'Roadmap'}</button>)}
    </div></nav>
    <main className="max-w-[1120px] mx-auto px-5 py-8 sm:py-10">
      {view.page === 'stage' && <button className="secondary mb-6" onClick={() => navigate({ page: 'roadmap' })}>← Back to roadmap</button>}
      <p className="eyebrow">{view.page === 'overview' ? 'Agentic AI Engineering' : view.page === 'roadmap' ? 'Learning roadmap' : stage ? `Stage ${String(stage.order).padStart(2, '0')} of 7` : 'Stage unavailable'}</p>
      <h1 ref={heading} tabIndex={-1}>{title}</h1>
      {view.page === 'overview' ? <>
        <p className="intro overview-guide">Choose a stage, take a diagnostic to find gaps, then learn, practice and reassess. You can also read lessons before a diagnostic.</p>
        {load.status === 'loading' && <p className="panel" role="status">Loading your learning overview…</p>}
        {load.status === 'error' && <section className="panel" role="alert"><p>{load.message}</p><button className="primary mt-3" onClick={()=>{setLoad({status:'loading'});setRequest(n=>n+1)}}>Retry loading</button></section>}
        {load.status==='ready'&&<Dashboard snapshot={snapshot} stage={dashboardStage!} stages={load.data.path.stages} onOpen={hash=>{if(!window.dispatchEvent(new Event('skillpilot:leave-assessment',{cancelable:true})))return;window.history.pushState(null,'',hash);lastRoute.current=hash;moved.current=true;setView(readView(hash));window.dispatchEvent(new Event('popstate'))}}/>}
      </> : load.status === 'loading' ? <div className="panel" role="status">Loading your roadmap…</div>
        : load.status === 'error' ? <section className="panel" role="alert"><h2>The roadmap is unavailable</h2><p>{load.message}</p><button className="primary mt-5" onClick={() => { setLoad({ status: 'loading' }); setRequest(value => value + 1) }}>Retry loading</button></section>
          : view.page === 'roadmap' ? <RoadmapView stages={load.data.path.stages} onOpen={id=>{returnStage.current=id;navigate({page:'stage',id})}}/> : stage ? <p className="intro">{stage.summary}</p> : <section className="panel"><p>The requested stage could not be found.</p><button className="primary mt-4" onClick={() => navigate({ page: 'roadmap' })}>Return to roadmap</button></section>}
      <div hidden={view.page !== 'stage' || !stage}>{load.status === 'ready' && <Assessment stage={stage ?? dashboardStage!} onSnapshot={setSnapshot} />}</div>
      <footer className="mt-8 text-sm text-slate-500">Week 1 · 50 questions per topic · Seven stages · Evidence-based recommendations</footer>
    </main>
  </>
}
