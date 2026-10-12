import curriculum from '../../../../backend/data/curriculum.json' with {type: 'json'}
const topicStages = new Map(curriculum.path.stages.flatMap(s => s.topics.map(t => [t.id, s.id] as const)))
const stageIds = new Set(curriculum.path.stages.map(s => s.id))
export type Mode = 'diagnostic' | 'practice' | 'reassessment'
export type Question = { id: string; topicId: string; conceptId: string; difficulty: string; prompt: string; options: { id: string; text: string }[] }
export type Delivery = { attemptId: string; mode: Mode; topicId: string | null; stageId: string; bankVersion: string; cycleId: string | null; receipt: string; issuedAt: number; expiresAt: number; questionCount: number; bankSize: number; warnings: string[]; questions: Question[] }
export type Result = { attemptId: string; mode: Mode; topicId: string | null; stageId: string; bankVersion: string; cycleId: string | null; correct: number; total: number; percentage: number; topics: { topicId: string; correct: number; total: number }[]; feedback: { questionId: string; selectedOptionId: string; correctOptionId: string; isCorrect: boolean; explanation: string; reference: { url: string; title: string } }[] }
export type Draft = { delivery: Delivery; answers: Record<string, string> }
export type Completed = { draft: Draft; result: Result; completedAt: string; fingerprint: string }
export type Progress = { schemaVersion: 1 | 2; initialDiagnosticByStage?: Record<string, string>; curriculumVersion: string; activeAttempt?: Draft; completedAttempts: Completed[]; topicCycles: Record<string, { bankVersion: string; cycleId: string; usedQuestionIds: string[] }>; diagnosticExposure: Record<string, string[]>; initialDiagnosticAttemptId?: string }
export const KEY = 'skillpilot.progress.v1'
export const emptyProgress = (): Progress => ({ schemaVersion: 2, initialDiagnosticByStage: {}, curriculumVersion: '2026-10-07.2', completedAttempts: [], topicCycles: {}, diagnosticExposure: {} })
export function fingerprint(answers: Record<string, string>): string { return JSON.stringify(Object.entries(answers).sort(([a], [b]) => a.localeCompare(b))) }
const text = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0
const record = (value: unknown): boolean => Boolean(value && typeof value === 'object' && !Array.isArray(value))
const modes = ['diagnostic', 'practice', 'reassessment']
function validateResult(draft: Draft, result: Result): void {
  const d = draft.delivery
  if (!result || result.attemptId !== d.attemptId || result.mode !== d.mode || result.stageId !== d.stageId || result.topicId !== d.topicId || result.bankVersion !== d.bankVersion || result.cycleId !== d.cycleId || result.total !== d.questionCount || !Number.isInteger(result.correct) || result.correct < 0 || result.correct > result.total || !Number.isFinite(result.percentage) || Math.abs(result.percentage - 100 * result.correct / result.total) > 0.000001 || !Array.isArray(result.feedback) || result.feedback.length !== result.total || !Array.isArray(result.topics)) throw new Error('Saved result is invalid.')
  const counts = new Map<string, {correct: number; total: number}>(), seen = new Set<string>()
  for (const f of result.feedback) {
    const q = d.questions.find(q => q.id === f.questionId)
    if (!q || seen.has(f.questionId) || draft.answers[q.id] !== f.selectedOptionId || !q.options.some(o => o.id === f.correctOptionId) || typeof f.isCorrect !== 'boolean' || f.isCorrect !== (f.selectedOptionId === f.correctOptionId) || !text(f.explanation) || !f.reference || !text(f.reference.title) || !text(f.reference.url)) throw new Error('Saved feedback is invalid.')
    seen.add(q.id)
    const count = counts.get(q.topicId) ?? {correct: 0, total: 0}; count.total++; count.correct += Number(f.isCorrect); counts.set(q.topicId, count)
  }
  if (result.feedback.filter(f => f.isCorrect).length !== result.correct || result.topics.length !== counts.size || new Set(result.topics.map(t => t.topicId)).size !== counts.size || result.topics.some(t => t.total !== counts.get(t.topicId)?.total || t.correct !== counts.get(t.topicId)?.correct)) throw new Error('Saved topic totals are invalid.')
}
export function validateDraft(draft: Draft): void {
  if (!draft || !draft.delivery || typeof draft.delivery.attemptId !== 'string' || typeof draft.delivery.receipt !== 'string' || !Array.isArray(draft.delivery.questions) || draft.delivery.questions.length < 1 || draft.delivery.questions.length > 100 || !draft.answers || typeof draft.answers !== 'object') throw new Error('Saved attempt is invalid.')
  const d = draft.delivery
  if (!modes.includes(d.mode) || !stageIds.has(d.stageId) || !text(d.attemptId) || !text(d.receipt) || !text(d.bankVersion) || !Number.isInteger(d.issuedAt) || !Number.isInteger(d.expiresAt) || d.expiresAt <= d.issuedAt || !Number.isInteger(d.questionCount) || d.questionCount !== d.questions.length || !Number.isInteger(d.bankSize) || d.bankSize < d.questionCount || !Array.isArray(d.warnings) || d.warnings.some(w => !text(w)) || !record(draft.answers) || (d.mode === 'diagnostic' ? d.topicId !== null || d.cycleId !== null : !text(d.topicId) || !text(d.cycleId))) throw new Error('Saved delivery is invalid.')
  const ids = new Set<string>()
  for (const q of draft.delivery.questions) {
    if (!q || typeof q.id !== 'string' || ids.has(q.id) || typeof q.prompt !== 'string' || !Array.isArray(q.options) || q.options.length !== 4 || new Set(q.options.map(o => o.id)).size !== 4 || q.options.some(o => typeof o.id !== 'string' || typeof o.text !== 'string')) throw new Error('Saved question is invalid.')
    if (!text(q.id) || !text(q.topicId) || topicStages.get(q.topicId) !== d.stageId || !text(q.conceptId) || !['easy','medium','hard'].includes(q.difficulty) || !text(q.prompt) || q.options.some(o => !text(o.id) || !text(o.text)) || (d.topicId && q.topicId !== d.topicId)) throw new Error('Saved question mapping is invalid.')
    ids.add(q.id)
    if (Object.hasOwn(draft.answers,q.id) && !q.options.some(o => o.id === draft.answers[q.id])) throw new Error('Saved answer is invalid.')
  }
  if (Object.keys(draft.answers).some(id => !ids.has(id))) throw new Error('Saved answer set is invalid.')
}
export function restore(raw: string | null): Progress {
  if (!raw) return emptyProgress()
  const p = JSON.parse(raw) as Progress
  if (!p || ![1,2].includes(p.schemaVersion) || !['2026-10-07.1','2026-10-07.2'].includes(p.curriculumVersion) || !Array.isArray(p.completedAttempts) || !record(p.topicCycles) || !record(p.diagnosticExposure)) throw new Error('Saved progress is corrupt or incompatible. Reset only if you want to discard it.')
  if ((p.schemaVersion === 1 && p.curriculumVersion !== '2026-10-07.1') || (p.schemaVersion === 2 && p.curriculumVersion !== '2026-10-07.2')) throw new Error('Saved schema and curriculum versions disagree.')
  if (p.schemaVersion === 1 && p.completedAttempts.some(c => c?.result?.stageId !== 'stage-01')) throw new Error('Legacy progress contains unsupported stages.')
  if (p.activeAttempt) validateDraft(p.activeAttempt)
  const ids = new Set<string>()
  for (const c of p.completedAttempts) {
    validateDraft(c.draft)
    if (!c.result || c.result.attemptId !== c.draft.delivery.attemptId || ids.has(c.result.attemptId) || !Array.isArray(c.result.feedback) || !Array.isArray(c.result.topics) || c.fingerprint !== fingerprint(c.draft.answers)) throw new Error('Saved completion is invalid.')
    validateResult(c.draft,c.result)
    if (!text(c.completedAt) || !Number.isFinite(Date.parse(c.completedAt)) || Object.keys(c.draft.answers).length !== c.draft.delivery.questionCount) throw new Error('Saved completion date or answers are invalid.')
    ids.add(c.result.attemptId)
  }
  for (const cycle of Object.values(p.topicCycles)) if (!cycle || typeof cycle.bankVersion !== 'string' || typeof cycle.cycleId !== 'string' || !Array.isArray(cycle.usedQuestionIds) || cycle.usedQuestionIds.some(id => typeof id !== 'string') || new Set(cycle.usedQuestionIds).size !== cycle.usedQuestionIds.length) throw new Error('Saved history is invalid.')
  if (Object.values(p.diagnosticExposure).some(ids => !Array.isArray(ids) || ids.some(id => typeof id !== 'string'))) throw new Error('Diagnostic history is invalid.')
  if (p.initialDiagnosticAttemptId && !p.completedAttempts.some(c => c.result.attemptId === p.initialDiagnosticAttemptId && c.result.mode === 'diagnostic')) throw new Error('Saved baseline is invalid.')
  if (p.activeAttempt && ids.has(p.activeAttempt.delivery.attemptId)) throw new Error('Saved draft duplicates a completion.')
  for (const [topicId, cycle] of Object.entries(p.topicCycles)) {
    if (!text(topicId) || !text(cycle.bankVersion) || !text(cycle.cycleId)) throw new Error('Saved cycle is invalid.')
    const used = p.completedAttempts.filter(c => c.result.topicId === topicId && c.result.bankVersion === cycle.bankVersion && c.result.cycleId === cycle.cycleId).flatMap(c => c.draft.delivery.questions.map(q => q.id))
    if (new Set(used).size !== used.length || used.length !== cycle.usedQuestionIds.length || used.some(id => !cycle.usedQuestionIds.includes(id))) throw new Error('Saved cycle history is inconsistent.')
  }
  for (const c of p.completedAttempts.filter(c => c.result.mode !== 'diagnostic')) if (!p.topicCycles[c.result.topicId!]) throw new Error('Saved topic cycle is missing.')
  for (const [version, exposure] of Object.entries(p.diagnosticExposure)) {
    const used = new Set(p.completedAttempts.filter(c => c.result.mode === 'diagnostic' && c.result.bankVersion === version).flatMap(c => c.draft.delivery.questions.map(q => q.id)))
    if (!text(version) || new Set(exposure).size !== exposure.length || exposure.length !== used.size || exposure.some(id => !used.has(id))) throw new Error('Saved diagnostic exposure is inconsistent.')
  }
  for (const c of p.completedAttempts.filter(c => c.result.mode === 'diagnostic')) if (!p.diagnosticExposure[c.result.bankVersion]) throw new Error('Saved diagnostic exposure is missing.')
  const firstDiagnostic = p.completedAttempts.find(c => c.result.mode === 'diagnostic' && c.result.stageId === 'stage-01')
  if (p.initialDiagnosticAttemptId !== firstDiagnostic?.result.attemptId) throw new Error('Saved baseline is inconsistent.')
  const baselines = Object.fromEntries(curriculum.path.stages.flatMap(stage => {
    const first = p.completedAttempts.find(c => c.result.mode === 'diagnostic' && c.result.stageId === stage.id)
    return first ? [[stage.id, first.result.attemptId]] : []
  }))
  if (p.schemaVersion === 2 && (!record(p.initialDiagnosticByStage) || JSON.stringify(Object.entries(p.initialDiagnosticByStage!).sort()) !== JSON.stringify(Object.entries(baselines).sort()))) throw new Error('Saved stage baselines are inconsistent.')
  p.initialDiagnosticByStage = baselines
  p.schemaVersion = 2
  p.curriculumVersion = '2026-10-07.2'
  return p
}
export function complete(progress: Progress, draft: Draft, result: Result, now = new Date().toISOString()): Progress {
  validateDraft(draft)
  validateResult(draft,result)
  const fp = fingerprint(draft.answers)
  const existing = progress.completedAttempts.find(c => c.result.attemptId === result.attemptId)
  if (existing) {
    if (existing.fingerprint !== fp || JSON.stringify(existing.result) !== JSON.stringify(result)) throw new Error('Conflicting retry rejected.')
    return progress
  }
  const d = draft.delivery
  if (result.attemptId !== d.attemptId || result.mode !== d.mode || result.bankVersion !== d.bankVersion || result.topicId !== d.topicId || result.cycleId !== d.cycleId || result.total !== d.questions.length || result.feedback.length !== d.questions.length || !Array.isArray(result.topics) || result.correct < 0 || result.correct > result.total) throw new Error('Invalid result binding.')
  if (result.feedback.some(f => draft.answers[f.questionId] !== f.selectedOptionId) || new Set(result.feedback.map(f => f.questionId)).size !== d.questions.length) throw new Error('Invalid result answers.')
  const next = structuredClone(progress)
  next.completedAttempts.push({ draft, result, completedAt: now, fingerprint: fp })
  delete next.activeAttempt
  if (d.mode === 'diagnostic') {
    next.initialDiagnosticByStage ??= {}
    next.initialDiagnosticByStage[d.stageId] ??= d.attemptId
    if (d.stageId === 'stage-01') next.initialDiagnosticAttemptId ??= d.attemptId
    next.diagnosticExposure[d.bankVersion] = [...new Set([...(next.diagnosticExposure[d.bankVersion] ?? []), ...d.questions.map(q => q.id)])]
  } else {
    const cycle = next.topicCycles[d.topicId!]
    if (!cycle || cycle.cycleId !== d.cycleId || cycle.bankVersion !== d.bankVersion) throw new Error('This topic cycle changed in another tab.')
    if (d.questions.some(q => cycle.usedQuestionIds.includes(q.id))) throw new Error('This attempt overlaps completed topic history.')
    cycle.usedQuestionIds.push(...d.questions.map(q => q.id))
  }
  return next
}

export function saveProgress(storage: Pick<Storage, 'getItem' | 'setItem'>, progress: Progress, expected: string | null): string {
  if (storage.getItem(KEY) !== expected) throw new Error('Saved state changed in another tab. Reload to continue safely.')
  const raw = JSON.stringify(restore(JSON.stringify(progress)))
  storage.setItem(KEY, raw)
  return raw
}
