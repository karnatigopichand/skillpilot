import { useEffect, useRef, useState } from 'react'
import LessonReader from '../learning-content/LessonReader'
import DiagnosticResults from './DiagnosticResults'
import { StatusBadge, TopicEvidence } from './Mastery'
import { useMastery } from './useMastery'
import { historyAttempts, readWorkspace, selectTopic, sidebarStatus, workspaceHash } from './workspace'
import type { ProgressSnapshot } from '../dashboard/Dashboard'
import type { Workspace } from './workspace'
import type { Stage } from '../learning-paths/catalog'
import { KEY, complete, emptyProgress, restore, saveProgress } from './progress'
import type { Delivery, Mode, Progress, Result } from './progress'

type BankInfo = { stageId: string; bankVersion: string; topics: { topicId: string; bankSize: number }[] }
async function api<T>(path: string, body?: unknown): Promise<T> {
  const response = await fetch(`/api/assessments/${path}`, body === undefined ? undefined : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  const value = await response.json()
  if (!response.ok) throw new Error(typeof value.detail === 'object' && value.detail.message ? value.detail.message : 'Assessment request failed. Please retry.')
  return value as T
}

export default function Assessment({ stage, onSnapshot }: { stage: Stage; onSnapshot?: (snapshot: ProgressSnapshot) => void }) {
  const topicName = (id: string) => stage.topics.find(t => t.id === id)?.title ?? id
  const [state, setState] = useState<{ progress: Progress; error: string; blocked: boolean }>(() => {
    try { return { progress: restore(localStorage.getItem(KEY)), error: '', blocked: false } }
    catch (e) { return { progress: emptyProgress(), error: e instanceof Error ? e.message : 'Storage is unavailable.', blocked: true } }
  })
  const [bankState, setBank] = useState<BankInfo | null>(null)
  const bank = bankState?.stageId === stage.id ? bankState : null
  const [busy, setBusy] = useState(false)
  const [transientResult, setTransientResult] = useState<Result | null>(null)
  const [workspace, setWorkspace] = useState(() => readWorkspace(window.location.hash))
  const route = useRef(window.location.hash)
  const workspaceHeading = useRef<HTMLHeadingElement>(null)
  const focusAfterHistory = useRef(false)
  const [index, setIndex] = useState(0)
  const [notice, setNotice] = useState('')
  const [hasPending, setHasPending] = useState(false)
  const saved = useRef<string | null>(null)
  const pending = useRef<Progress | null>(null)
  const legend = useRef<HTMLLegendElement>(null)
  const latest = useRef(state.progress)
  const draft = state.progress.activeAttempt
  const p = state.progress
  const result = workspace.attemptId ? p.completedAttempts.find(c => c.result.stageId === stage.id && c.result.attemptId === workspace.attemptId)?.result ?? (transientResult?.attemptId === workspace.attemptId ? transientResult : null) : null
  const mastery = useMastery(p, bank?.bankVersion ?? '', stage.id)
  useEffect(() => { onSnapshot?.({stageId:stage.id,progress:p,blocked:state.blocked,error:state.error,unsaved:hasPending,bankVersion:bank?.bankVersion??'',mastery:{plan:mastery.plan,error:mastery.error,loading:mastery.loading,key:mastery.key}}) }, [p,state.blocked,state.error,hasPending,bank?.bankVersion,mastery.plan,mastery.error,mastery.loading,mastery.key,onSnapshot,stage.id])
  const selectedTopic = stage.topics.find(t => t.id === workspace.topicId)
  useEffect(() => { latest.current = p }, [p])

  useEffect(() => { try { saved.current = localStorage.getItem(KEY) } catch { /* restore already reports failure */ } }, [])
  useEffect(() => {
    let active = true
    api<BankInfo>('bank-info?stageId=' + stage.id).then(value => { if (active) setBank(value) }).catch(e => { if (active) setNotice(e.message) })
    return () => { active = false }
  }, [stage.id])
  useEffect(() => {
    const listener = (event: StorageEvent) => {
      if (event.key !== KEY) return
      try {
        const progress = restore(event.newValue)
        saved.current = event.newValue; pending.current = null; setHasPending(false); latest.current = progress
        setState({ progress, error: 'Progress changed in another tab. Review the restored state before continuing.', blocked: true }); setTransientResult(null); setIndex(0)
      } catch { setState(s => ({ ...s, blocked: true, error: 'Another tab saved incompatible progress. Assessment is blocked.' })) }
    }
    window.addEventListener('storage', listener)
    return () => window.removeEventListener('storage', listener)
  }, [])

  useEffect(() => { legend.current?.focus() }, [index, draft?.delivery.attemptId])

  useEffect(() => {
    const leave = (event: Event) => {
      if (busy) { event.preventDefault(); setNotice('Wait for the assessment request to finish before navigating.'); return }
      if (!latest.current.activeAttempt && !pending.current) return
      if (!window.confirm('Discard the unfinished or unsaved attempt and leave? Cancel resumes it. No completed batch will be consumed.')) { event.preventDefault(); return }
      if (pending.current) { event.preventDefault(); setNotice('Save or discard unsaved work before leaving.'); return }
      const next = structuredClone(latest.current); delete next.activeAttempt
      if (!persist(next)) event.preventDefault()
    }
    const unload = (event: BeforeUnloadEvent) => { if (pending.current) { event.preventDefault(); event.returnValue = '' } }
    window.addEventListener('skillpilot:leave-assessment', leave)
    window.addEventListener('beforeunload', unload)
    return () => { window.removeEventListener('skillpilot:leave-assessment', leave); window.removeEventListener('beforeunload', unload) }
  })

  useEffect(() => {
    const changed = () => {
      if (window.location.hash === route.current) return
      if (latest.current.activeAttempt && !window.dispatchEvent(new Event('skillpilot:leave-assessment', { cancelable: true }))) {
        window.history.pushState(null, '', route.current); return
      }
      route.current = window.location.hash; focusAfterHistory.current = true
      setWorkspace(readWorkspace(window.location.hash)); setTransientResult(null); setNotice(''); setIndex(0)
    }
    window.addEventListener('popstate', changed); window.addEventListener('hashchange', changed)
    return () => { window.removeEventListener('popstate', changed); window.removeEventListener('hashchange', changed) }
  }, [])
  useEffect(() => { if (focusAfterHistory.current) { workspaceHeading.current?.focus(); focusAfterHistory.current = false } }, [workspace.tab, workspace.topicId, workspace.attemptId, workspace.lesson])

  function persist(progress: Progress): boolean {
    try {
      const raw = saveProgress(localStorage, progress, saved.current)
      saved.current = raw; pending.current = null; setHasPending(false); latest.current = progress
      setState({ progress, error: '', blocked: false }); return true
    } catch (e) {
      pending.current = progress; setHasPending(true)
      setState({ progress, error: `Not saved; refreshing may lose this attempt. ${e instanceof Error ? e.message : ''}`, blocked: true }); return false
    }
  }
  async function start(mode: Mode, topicId: string | null = null) {
    if (!bank || draft || state.blocked || busy) return
    setBusy(true); setNotice(''); setTransientResult(null); updateWorkspace({ ...workspace, tab: 'assessments', lesson: undefined, attemptId: null })
    try {
      let progress = p
      let cycle = topicId ? progress.topicCycles[topicId] : null
      if (topicId && (!cycle || cycle.bankVersion !== bank.bankVersion)) {
        if (cycle && !window.confirm('The bank version changed. Start a new history for this version? Historical attempts will remain.')) return
        progress = structuredClone(progress)
        progress.topicCycles[topicId] = { bankVersion: bank.bankVersion, cycleId: crypto.randomUUID(), usedQuestionIds: [] }
        if (!persist(progress)) return
        cycle = progress.topicCycles[topicId]
      }
      const exposure = progress.diagnosticExposure[bank.bankVersion] ?? []
      const source = saved.current
      const diagnosticTopicCounts = mode === 'diagnostic' ? Object.fromEntries(bank.topics.map(t => [t.topicId, progress.completedAttempts.filter(c => c.result.mode === 'diagnostic' && c.result.bankVersion === bank.bankVersion).reduce((count, c) => count + (c.result.topics.find(topic => topic.topicId === t.topicId)?.total ?? 0), 0)])) : {}
      const delivery = await api<Delivery>('start', { mode, stageId: stage.id, topicId, bankVersion: bank.bankVersion, cycleId: cycle?.cycleId ?? null, usedQuestionIds: cycle?.usedQuestionIds ?? [], diagnosticExposure: mode === 'diagnostic' ? exposure : [], diagnosticTopicCounts })
      if (saved.current !== source || localStorage.getItem(KEY) !== source) throw new Error('Progress changed while preparing the quiz. Reload before continuing.')
      const next = { ...progress, activeAttempt: { delivery, answers: {} } }
      persist(next); setIndex(0)
    } catch (e) { setNotice(e instanceof Error ? e.message : 'Start failed.') }
    finally { setBusy(false) }
  }
  function discard() {
    if (!window.confirm('Discard the unfinished or unsaved attempt? It will not consume a completed batch.')) return
    const next = structuredClone(latest.current)
    if (pending.current) {
      try { const authoritative = restore(localStorage.getItem(KEY)); saved.current = localStorage.getItem(KEY); delete authoritative.activeAttempt; persist(authoritative); setResult(null); return } catch { setNotice('Storage could not be read. Reload or explicitly reset saved progress.'); return }
    }
    delete next.activeAttempt; persist(next); setResult(null)
  }
  async function submit() {
    if (!draft || busy || state.blocked) return
    if (draft.delivery.expiresAt <= Date.now()/1000 || (bank && draft.delivery.bankVersion !== bank.bankVersion)) { setNotice('This saved attempt expired or uses an older bank. Discard it and start again; no completed batch will be consumed.'); return }
    const unanswered = draft.delivery.questions.findIndex(q => !draft.answers[q.id])
    if (unanswered >= 0) { setIndex(unanswered); setNotice('Answer every question before submitting.'); return }
    setBusy(true); setNotice('')
    try {
      const source = saved.current
      const response = await api<Result>('submit', { receipt: draft.delivery.receipt, answers: Object.entries(draft.answers).map(([questionId, optionId]) => ({ questionId, optionId })) })
      if (saved.current !== source || localStorage.getItem(KEY) !== source) throw new Error('Progress changed during submission. Reload to review the saved state.')
      const next = complete(latest.current, draft, response)
      persist(next); setResult(response)
    } catch (e) { setNotice(e instanceof Error ? e.message : 'Submission failed. Retry with the same answers.') }
    finally { setBusy(false) }
  }
  function resetStorage() {
    if (!window.confirm('Reset ALL local assessment progress, drafts, cycles and baseline? This cannot be undone.')) return
    try { saved.current = localStorage.getItem(KEY); pending.current = null; persist(emptyProgress()); setResult(null) } catch { setNotice('Storage remains unavailable.') }
  }
  function updateWorkspace(next: Workspace, replace = false) {
    const hash = workspaceHash(next, stage.id)
    route.current = hash; focusAfterHistory.current = next.attemptId !== workspace.attemptId
    window.history[replace ? 'replaceState' : 'pushState'](null, '', hash)
    setWorkspace(next)
    window.dispatchEvent(new Event('popstate'))
  }
  function setResult(value: Result | null) {
    setTransientResult(value)
    updateWorkspace({ ...workspace, attemptId: value?.attemptId ?? null })
  }
  function navigateWorkspace(next: Workspace) {
    if (!window.dispatchEvent(new Event('skillpilot:leave-assessment', { cancelable: true }))) return
    setTransientResult(null); updateWorkspace(next)
  }
  const completed = result ? p.completedAttempts.find(c => c.result.attemptId === result.attemptId) : null
  const question = draft?.delivery.questions[Math.min(index, draft.delivery.questions.length - 1)]
  const topicEvidence = !mastery.loading && !mastery.error ? mastery.plan?.topics.find(t => t.topicId === selectedTopic?.id) : null
  const latestTopicResult = p.completedAttempts.filter(c => c.result.topicId === selectedTopic?.id).sort((a,b) => Date.parse(b.completedAt) - Date.parse(a.completedAt))[0]
  const recommendation = mastery.plan?.recommendations.find(r => r.topicId === selectedTopic?.id)
  const initialDiagnostic = p.completedAttempts.find(c => c.result.attemptId === p.initialDiagnosticByStage?.[stage.id])
  const initialTopicScore = initialDiagnostic?.result.topics.find(t => t.topicId === selectedTopic?.id)
  const historicalBaseline = initialDiagnostic && initialTopicScore && initialDiagnostic.result.bankVersion !== bank?.bankVersion ? {attemptId:initialDiagnostic.result.attemptId,mode:'diagnostic',completedAt:initialDiagnostic.completedAt,bankVersion:initialDiagnostic.result.bankVersion,...initialTopicScore,percentage:100 * initialTopicScore.correct / initialTopicScore.total} : undefined
  function topicActions(topicId: string) {
    const info = bank?.topics.find(t => t.topicId === topicId)
    if (!bank || !info) return <section className="panel"><h2>Practice and reassessment</h2><p>Topic bank is unavailable. Retry loading bank information to see available actions.</p></section>
    const cycle = p.topicCycles[topicId]
    const remaining = info.bankSize - (cycle?.bankVersion === bank.bankVersion ? cycle.usedQuestionIds.length : 0)
    return <section className="panel"><h2>Practice and reassessment</h2><p>{Math.max(0, remaining)} of {info.bankSize} questions unused in this cycle. Feedback after full submission; both modes share completed question history.</p>
      {remaining > 0 ? <div className="flex gap-3 flex-wrap mt-4"><button className="secondary" disabled={busy || state.blocked} onClick={() => void start('practice', topicId)}>Practice</button><button className="primary" disabled={busy || state.blocked} onClick={() => void start('reassessment', topicId)}>Topic reassessment</button></div> : <><p className="mt-3">This bank is exhausted. Repeat questions only by explicitly starting a new cycle.</p><button className="primary mt-4" disabled={busy || state.blocked} onClick={() => { if (!window.confirm('Start a new randomized cycle? Previously completed questions may repeat.')) return; const next = structuredClone(p); next.topicCycles[topicId] = { bankVersion: bank.bankVersion, cycleId: crypto.randomUUID(), usedQuestionIds: [] }; persist(next) }}>Start a new randomized cycle…</button></>}
      <p className="text-sm text-slate-500 mt-3">Next attempt: {Math.min(20, Math.max(0, remaining))} questions. A short attempt is insufficient for mastery; practice never updates status.</p>
    </section>
  }
  function diagnosticAction() {
    return <section className="panel hero"><h2>Stage diagnostic</h2><p>Assess {stage.title} across all approved topics. Current diagnostic: {bank ? Math.min(bank.topics.length * 3 + 2, bank.topics.reduce((sum,t) => sum + Math.min(3, t.bankSize), 0) + 2) : 'Loading'} questions across the stage.</p>
      <button className="primary mt-4" disabled={busy || state.blocked || !bank || stage.diagnosticStatus !== 'available'} onClick={() => void start('diagnostic')}>Take stage diagnostic</button>
      <p className="text-sm text-slate-500 mt-3">Diagnostic questions may recur in topic quizzes. Sparse evidence never establishes mastery.{(p.diagnosticExposure[bank?.bankVersion ?? '']?.length ?? 0) > 0 && ' Previously seen diagnostic questions may recur.'}</p>
    </section>
  }
  return <div className="stage-workspace">
    <aside className="stage-sidebar" aria-label="Stage topic navigation">
      <button className={`stage-topic-button ${!workspace.topicId ? 'selected' : ''}`} aria-current={!workspace.topicId ? 'page' : undefined} onClick={() => navigateWorkspace(selectTopic(workspace, null))}><span aria-hidden="true">⌂ </span>Stage overview</button>
      <p className="text-sm text-slate-500 px-3 mt-5 mb-2">Topics · {stage.topics.length}</p>
      {stage.topics.map(topic => { const status = !mastery.loading && !mastery.error ? mastery.plan?.topics.find(t => t.topicId === topic.id)?.status : undefined; return <button key={topic.id} className={`stage-topic-button ${workspace.topicId === topic.id ? 'selected' : ''}`} aria-current={workspace.topicId === topic.id ? 'page' : undefined} onClick={() => navigateWorkspace(selectTopic(workspace, topic.id))}><span>{topic.title}</span><span className="block mt-2"><StatusBadge status={status}/></span></button> })}
    </aside>
    <section className="min-w-0" aria-label="Stage learning workspace">
      <div className="stage-topic-select"><label htmlFor="stage-topic-select" className="block font-medium mb-2">Stage topic</label><select id="stage-topic-select" value={workspace.topicId ?? ''} onChange={e => navigateWorkspace(selectTopic(workspace, e.target.value || null))} className="w-full bg-white border border-slate-300 rounded-lg p-3"><option value="">Stage overview</option>{stage.topics.map(topic => <option key={topic.id} value={topic.id}>{topic.title} · {sidebarStatus(!mastery.loading && !mastery.error ? mastery.plan?.topics.find(t=>t.topicId===topic.id)?.status : undefined)}</option>)}</select></div>
      <div role="tablist" aria-label="Stage workspace" className="flex gap-2 border-b border-slate-200 pb-3 flex-wrap">
        {(['overview','assessments','history'] as const).map(tab => <button key={tab} id={`stage-tab-${tab}`} role="tab" aria-selected={workspace.tab === tab} aria-controls="stage-workspace-panel" tabIndex={workspace.tab === tab ? 0 : -1} className={`nav-button ${workspace.tab === tab ? 'selected' : ''}`} onClick={() => navigateWorkspace({ ...workspace, tab, lesson: undefined, attemptId: null })} onKeyDown={e => { const tabs = ['overview','assessments','history'] as const; const current=tabs.indexOf(tab); const next=e.key==='Home'?0:e.key==='End'?2:e.key==='ArrowRight'?(current+1)%3:e.key==='ArrowLeft'?(current+2)%3:-1; if(next<0)return;e.preventDefault();navigateWorkspace({...workspace,tab:tabs[next],lesson:undefined,attemptId:null});document.getElementById(`stage-tab-${tabs[next]}`)?.focus() }}>{tab[0].toUpperCase()+tab.slice(1)}</button>)}
      </div>
      <div id="stage-workspace-panel" role="tabpanel" aria-labelledby={`stage-tab-${workspace.tab}`}>
      <h2 ref={workspaceHeading} tabIndex={-1} className="mt-5">{draft ? 'Assessment in progress' : result ? 'Assessment results' : selectedTopic?.title ?? (workspace.tab === 'history' ? 'Saved stage attempts' : workspace.tab === 'assessments' ? 'Assessments' : 'Stage overview')}</h2>
      {notice && <p className="panel" role="alert">{notice}</p>}
      {state.error && <div className="panel" role="alert"><p>{state.error}</p><div className="flex gap-3 flex-wrap mt-4">{hasPending && <><button className="primary" onClick={() => persist(pending.current!)}>Retry saving</button><button className="secondary" onClick={discard}>Discard unsaved work</button></>}<button className="secondary" onClick={() => window.location.reload()}>Reload saved state</button><button className="secondary" onClick={resetStorage}>Reset local progress…</button></div></div>}
      {!bank && <div className="panel"><p role="status">Bank information is not loaded.</p><button className="secondary mt-3" onClick={() => api<BankInfo>('bank-info?stageId=' + stage.id).then(setBank).catch(e=>setNotice(e.message))}>Retry bank information</button></div>}
      {workspace.topicId && !selectedTopic ? <div className="panel"><p>This topic is not in the current curriculum.</p><button className="secondary" onClick={() => navigateWorkspace(selectTopic(workspace,null))}>Stage overview</button></div> : draft && question ? <div className="panel">
        <p className="eyebrow">{draft.delivery.mode} · {draft.delivery.questionCount} questions</p><p className="text-sm text-slate-500">This exact attempt resumes after refresh. Discard consumes no completed batch.</p>{draft.delivery.warnings.map(w=><p key={w} className="text-sm text-slate-500 mt-2">{w}</p>)}
        {(draft.delivery.expiresAt <= Date.now()/1000 || (bank && draft.delivery.bankVersion !== bank.bankVersion))&&<p className="mt-3" role="alert">This saved attempt expired or uses an older bank. Discard it to start again. No completed batch will be consumed.</p>}
        <p className="mt-4">Question {index+1} of {draft.delivery.questionCount} · {Object.keys(draft.answers).length} answered</p>
        <form onSubmit={e=>{e.preventDefault();void submit()}}><fieldset disabled={busy||state.blocked} className="mt-4"><legend ref={legend} tabIndex={-1} className="text-lg font-semibold">{question.prompt}</legend><p className="text-sm text-slate-500 mt-2">{topicName(question.topicId)}</p><div className="flex flex-col gap-3 mt-4">{question.options.map(option=><label key={option.id} className="flex gap-3 border border-slate-200 rounded-lg p-4 cursor-pointer"><input type="radio" name={question.id} value={option.id} checked={draft.answers[question.id]===option.id} onChange={()=>{const next=structuredClone(p);next.activeAttempt!.answers[question.id]=option.id;persist(next)}}/><span>{option.text}</span></label>)}</div></fieldset>
          <div className="flex gap-3 flex-wrap mt-5"><button type="button" className="secondary" disabled={busy||index===0} onClick={()=>setIndex(i=>i-1)}>Previous</button>{index<draft.delivery.questionCount-1&&<button type="button" className="secondary" disabled={busy} onClick={()=>setIndex(i=>i+1)}>Next</button>}<button className="primary" disabled={busy||state.blocked||draft.delivery.expiresAt<=Date.now()/1000||Boolean(bank&&draft.delivery.bankVersion!==bank.bankVersion)}>{busy?'Submitting…':'Submit all answers'}</button><button type="button" className="secondary" disabled={busy} onClick={discard}>Discard attempt…</button></div>
        </form>
      </div> : result && completed ? <>
        <DiagnosticResults topics={stage.topics} backLabel="Back to history" key={result.attemptId} completed={completed} saved={!state.blocked} onBack={()=>{setTransientResult(null);updateWorkspace({...workspace,tab:'history',attemptId:null})}}/>
      </> : workspace.attemptId ? <div className="panel"><p>This saved attempt is not available.</p><button className="secondary" onClick={()=>setResult(null)}>Return to history</button></div> : workspace.tab==='history' ? <section className="panel"><div className="flex gap-3 flex-wrap mb-4"><button className="secondary" aria-pressed={workspace.historyScope==='all'} onClick={()=>updateWorkspace({...workspace,historyScope:'all'},true)}>All stage attempts</button><button className="secondary" aria-pressed={workspace.historyScope==='selected'} disabled={!selectedTopic} onClick={()=>updateWorkspace({...workspace,historyScope:'selected'},true)}>Selected topic</button></div>
        {historyAttempts(p.completedAttempts.filter(c => c.result.stageId === stage.id),workspace).length===0?<p role="status">No saved attempts match this filter.</p>:<div className="history-list">{historyAttempts(p.completedAttempts.filter(c => c.result.stageId === stage.id),workspace).map(c=><article className="history-entry" key={c.result.attemptId}><div><p className="font-medium">{c.result.mode} · {c.result.topicId?stage.topics.find(t=>t.id===c.result.topicId)?.title??c.result.topicId:stage.title+' (stage)'}</p><p className="text-sm text-slate-500">{new Date(c.completedAt).toLocaleString()} · {c.result.correct}/{c.result.total} · {Math.round(c.result.percentage)}%{c.result.attemptId===p.initialDiagnosticByStage?.[stage.id]?' · Initial baseline':''}</p></div><button className="secondary" onClick={()=>setResult(c.result)}>View results</button></article>)}</div>}
      </section> : workspace.tab==='assessments' ? <>{diagnosticAction()}{selectedTopic?topicActions(selectedTopic.id):<section className="panel"><h2>Topic practice and reassessment</h2><p>Choose a topic from the topic navigation to see its available actions.</p></section>}</> : selectedTopic && workspace.lesson ? <LessonReader key={selectedTopic.id} topicId={selectedTopic.id} onBack={()=>updateWorkspace({...workspace,lesson:undefined})} actions={topicActions(selectedTopic.id)}/> : selectedTopic ? <>
        <p className="intro">{selectedTopic.description}</p>{selectedTopic.lessonStatus==='available'?<button className="primary mt-3" onClick={()=>navigateWorkspace({...workspace,tab:'overview',lesson:true,attemptId:null})}>Read lesson</button>:<span className="tag mt-3">Lesson unavailable</span>}
        {topicActions(selectedTopic.id)}
        <section className="panel"><h2>Latest topic result</h2>{latestTopicResult ? <><p>{latestTopicResult.result.mode[0].toUpperCase()+latestTopicResult.result.mode.slice(1)} · {latestTopicResult.result.correct}/{latestTopicResult.result.total} · {Math.round(latestTopicResult.result.percentage)}%</p><p className="text-sm text-slate-500">{new Date(latestTopicResult.completedAt).toLocaleString()}{latestTopicResult.result.bankVersion !== bank?.bankVersion ? ' · Earlier question set' : ''}</p><button className="secondary mt-3" onClick={() => setResult(latestTopicResult.result)}>View results</button></> : <p>No topic attempt completed yet.</p>}</section>
        {mastery.loading?<p role="status" className="panel">Loading your topic status…</p>:mastery.error?<section className="panel" role="alert"><p>{mastery.error} Saved attempts are preserved.</p><button className="secondary mt-3" onClick={mastery.retry}>Retry topic status</button></section>:topicEvidence&&<TopicEvidence topic={topicEvidence} historicalBaseline={historicalBaseline} action={recommendation?.action === 'diagnostic' ? <button className="secondary mt-3" disabled={busy || state.blocked || !bank} onClick={() => void start('diagnostic')}>Take stage diagnostic</button> : undefined}/>}

      </> : <>{diagnosticAction()}<p className="text-sm text-slate-500">Choose a topic to explore its summary, evidence and available practice. Lessons can be read before a diagnostic. A single 20-question reassessment is needed for a mastery band; each topic bank has 50 questions.</p></>}
      </div>
    </section>
  </div>
}
