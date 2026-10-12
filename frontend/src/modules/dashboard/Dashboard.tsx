import { jumpToSection } from './overview-navigation'
import { dashboardActivity } from './activity'
import type { Stage } from '../learning-paths/catalog'
import type { Progress } from '../assessment/progress'
import type { useMastery } from '../assessment/useMastery'
import { workspaceHash } from '../assessment/workspace'
export type ProgressSnapshot = {stageId?: string; progress: Progress; blocked: boolean; error: string; unsaved: boolean; bankVersion: string; mastery: Omit<ReturnType<typeof useMastery>, 'retry'>}

const overviewSections = [
  {id: 'overview-welcome', label: 'Welcome back'},
  {id: 'overview-roadmap', label: 'Roadmap'},
  {id: 'overview-next', label: 'Recommended next step'},
  {id: 'overview-latest', label: 'Latest saved result'},
]
export default function Dashboard({snapshot,stage,stages = [stage],onOpen}: {snapshot:ProgressSnapshot|null;stage:Stage;stages?:Stage[];onOpen:(hash:string)=>void}) {
  const open=(tab:'overview'|'history'|'assessments',topicId:string|null=null,attemptId:string|null=null,targetStage=stage.id)=>onOpen(workspaceHash({tab,topicId,attemptId,historyScope:'all'}, targetStage))
  const {count,latest}=snapshot && !snapshot.blocked ? dashboardActivity(snapshot.progress) : {count:0,latest:null}
  const current=snapshot?.stageId && snapshot.stageId !== stage.id ? {loading:true,error:undefined,plan:undefined} : snapshot?.mastery
  const recommendation=snapshot && !snapshot.blocked && current && !current.loading && !current.error ? current.plan?.recommendations[0] : undefined
  const optional=snapshot && !snapshot.blocked && current && !current.loading && !current.error ? current.plan?.optionalReview[0] : undefined
  const next=recommendation??optional
  const nextTopic=stage.topics.find(t=>t.id===next?.topicId)
  return <div className="overview-workspace">
    <aside className="overview-sidebar">
      <details open className="overview-navigation">
        <summary className="font-semibold">On this page</summary>
        <nav aria-label="Overview sections">
          {overviewSections.map((section,index)=><a key={section.id} href={`#overview?section=${section.id}`} onClick={event=>{event.preventDefault();jumpToSection(section.id)}}><span aria-hidden="true">{index+1}. </span>{section.label}</a>)}
        </nav>
      </details>
    </aside>
    <div className="min-w-0">
      <section className="panel hero" aria-labelledby="overview-welcome">
        <h2 id="overview-welcome" tabIndex={-1}>{snapshot?.blocked ? 'Saved progress needs attention' : count ? 'Welcome back.' : 'Begin your learning journey.'}</h2>
        {!snapshot ? <p role="status">Loading saved progress…</p> : snapshot.blocked ? <div role="alert"><p>{snapshot.error}</p><p className="text-sm text-slate-500 mt-3">{snapshot.unsaved?'Some work is not saved. Review recovery before continuing.':'Saved data has not been cleared. Review recovery before starting an assessment.'}</p><button className="primary mt-4" onClick={()=>open('overview')}>Open progress recovery</button></div> : <>
          <p>{count?`${count} completed assessment${count===1?'':'s'} saved in this browser.`:'Start with a stage diagnostic, or browse a topic lesson first.'}</p>
          <p className="text-sm text-slate-500 mt-3">Activity is not mastery. Progress is saved only in this browser.</p>
          <button className="primary mt-4" onClick={()=>open('overview')}>Open {stage.title}</button>
        </>}
      </section>
      <section className="panel" aria-labelledby="overview-roadmap">
        <p className="eyebrow">Seven stages. Your pace.</p>
        <h2 id="overview-roadmap" tabIndex={-1}>Your journey starts with a roadmap</h2>
        <p>Explore the path from AI foundations to production engineering. Open any stage without completing earlier ones.</p>
        <button className="primary mt-4" onClick={()=>onOpen('#roadmap')}>Explore the roadmap →</button>
        {snapshot?.blocked && <p className="text-sm text-slate-500 mt-3">Lessons remain available while you resolve saved progress.</p>}
      </section>
      <section className="panel" aria-labelledby="overview-next">
        <p className="eyebrow">{stage.title}</p>
        <h2 id="overview-next" tabIndex={-1}>Recommended next step</h2>
        {!snapshot ? <p role="status">Loading your next step…</p> : snapshot.blocked ? <><p>Resolve saved progress to evaluate recommendations. You can still browse lessons.</p><button className="secondary mt-3" onClick={()=>open('overview')}>Browse lessons</button></> : !snapshot.bankVersion ? <p role="status">Bank information is unavailable. Open the stage to retry; lessons are still available.</p> : current?.loading ? <p role="status">Evaluating saved evidence…</p> : current?.error ? <><p role="alert">Recommendations are unavailable: {current.error}</p><button className="secondary mt-3" onClick={()=>open('overview')}>Open evidence recovery</button></> : recommendation?.action==='diagnostic' ? <><p>{recommendation.reason}</p><button className="primary mt-4" onClick={()=>open('assessments')}>Take stage diagnostic</button><p className="text-sm text-slate-500 mt-3">You can read lessons before a diagnostic.</p></> : next && nextTopic ? <><p className="font-medium">{optional && !recommendation ? 'Optional review · ' : ''}{nextTopic.title}</p><p className="mt-2">{next.reason}</p><button className="primary mt-4" onClick={()=>open('overview',nextTopic.id)}>Continue with {nextTopic.title}</button></> : <p>Choose a topic to read a lesson or review its evidence. No recommended gap is claimed.</p>}
      </section>
      <section className="panel" aria-labelledby="overview-latest">
        <h2 id="overview-latest" tabIndex={-1}>Latest saved result</h2>
        {!snapshot ? <p role="status">Loading saved results…</p> : snapshot.blocked ? <p>Saved results will be available after progress recovery.</p> : latest ? <>
          <p className="font-medium">{latest.result.mode} · {latest.result.topicId?stages.flatMap(s=>s.topics).find(t=>t.id===latest.result.topicId)?.title??latest.result.topicId:(stages.find(s=>s.id===latest.result.stageId)?.title ?? latest.result.stageId)+' (stage)'}</p>
          <p className="mt-2">{latest.result.correct}/{latest.result.total} · {Math.round(latest.result.percentage)}%</p>
          <p className="text-sm text-slate-500 mt-2">{new Date(latest.completedAt).toLocaleString()} · {latest.result.bankVersion}{snapshot.bankVersion&&latest.result.bankVersion!==snapshot.bankVersion?' · Historical bank':''}</p>
          <div className="flex gap-3 flex-wrap mt-4"><button className="primary" onClick={()=>open('history',latest.result.topicId,latest.result.attemptId,latest.result.stageId)}>View latest results</button><button className="secondary" onClick={()=>open('history',null,null,latest.result.stageId)}>View history</button></div>
        </> : <p>No completed assessments yet. Your latest saved result will appear here.</p>}
      </section>
    </div>
  </div>
}
