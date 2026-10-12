import type { Completed } from './progress'
export type Workspace = { tab: 'overview' | 'assessments' | 'history'; topicId: string | null; attemptId: string | null; historyScope: 'all' | 'selected'; lesson?: boolean }
export function readWorkspace(hash: string): Workspace {
  const query = new URLSearchParams(hash.split('?')[1] ?? '')
  const tab = query.get('tab')
  return { ...(query.get('lesson') === '1' && query.get('topic') && (!tab || tab === 'overview') ? {lesson: true} : {}), tab: tab === 'assessments' || tab === 'history' ? tab : 'overview', topicId: query.get('topic'), attemptId: query.get('attempt'), historyScope: query.get('scope') === 'selected' ? 'selected' : 'all' }
}
export function workspaceHash(state: Workspace, stageId = 'stage-01'): string {
  const query = new URLSearchParams({ tab: state.tab })
  if (state.topicId) query.set('topic', state.topicId)
  if (state.lesson && state.topicId && state.tab === 'overview' && !state.attemptId) query.set('lesson', '1')
  if (state.attemptId) query.set('attempt', state.attemptId)
  if (state.historyScope === 'selected') query.set('scope', 'selected')
  return '#stage/' + stageId + '?' + query.toString()
}
export function selectTopic(state: Workspace, topicId: string | null): Workspace {
  const { lesson: _lesson, ...rest } = state
  return { ...rest, topicId, tab: topicId ? state.tab : 'overview', attemptId: null, historyScope: topicId ? state.historyScope : 'all' }
}
export function historyAttempts(attempts: Completed[], state: Workspace): Completed[] {
  return attempts.filter(c => state.historyScope !== 'selected' || Boolean(state.topicId && c.result.topicId === state.topicId)).sort((a,b) => Date.parse(b.completedAt) - Date.parse(a.completedAt))
}
export function sidebarStatus(status?: string): string {
  return status === 'Unknown' ? 'Unassessed' : status === 'Insufficient Evidence' ? 'Insufficient evidence' : status ?? 'Status unavailable'
}

export function statusAppearance(status?: string) {
  const styles: Record<string, {tone: string; icon: string}> = {
    Strong: {tone: 'strong', icon: '✓'},
    Developing: {tone: 'developing', icon: '◐'},
    'Needs Attention': {tone: 'attention', icon: '!'},
    'Insufficient Evidence': {tone: 'insufficient', icon: '◌'},
    Unknown: {tone: 'neutral', icon: '—'},
  }
  return {label: sidebarStatus(status), ...(styles[status ?? ''] ?? {tone: 'neutral', icon: '—'})}
}
