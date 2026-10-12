export type Topic = { id: string; stageId: string; order: number; title: string; description: string; lessonStatus: 'planned' | 'available' }
export type Stage = { id: string; order: number; title: string; summary: string; diagnosticStatus: 'planned' | 'available'; topics: Topic[] }
export type Roadmap = { schemaVersion: '1'; curriculumVersion: string; path: { id: string; title: string; summary: string; stages: Stage[] } }

const stageNames = ['AI Foundations', 'Building with AI', 'Knowledge & Retrieval (RAG)', 'Agent Engineering', 'Advanced AI Systems', 'Production AI Engineering', 'Interview & Career Readiness']
const object = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
const text = (v: unknown): v is string => typeof v === 'string' && v.trim().length > 0

export function parseRoadmap(value: unknown): Roadmap {
  const fail = () => { throw new Error('The roadmap data is unavailable. Please retry.') }
  if (!object(value) || value.schemaVersion !== '1' || !text(value.curriculumVersion) || !object(value.path)) return fail()
  const path = value.path
  if (path.id !== 'agentic-ai-engineering' || path.title !== 'Agentic AI Engineering' || !text(path.summary) || !Array.isArray(path.stages) || path.stages.length !== 7) return fail()
  const ids = new Set<string>(), orders = new Set<number>(), topicIds = new Set<string>()
  for (const stage of path.stages) {
    if (!object(stage) || !text(stage.id) || !Number.isInteger(stage.order) || typeof stage.order !== 'number' || stage.order < 1 || stage.order > 7 || stage.title !== stageNames[stage.order - 1] || !text(stage.summary) || !(stage.diagnosticStatus === 'planned' || stage.diagnosticStatus === 'available') || !Array.isArray(stage.topics)) return fail()
    if (ids.has(stage.id) || orders.has(stage.order)) return fail()
    ids.add(stage.id); orders.add(stage.order)
    const topicOrders = new Set<number>()
    for (const topic of stage.topics) {
      if (!object(topic) || !text(topic.id) || topic.stageId !== stage.id || !Number.isInteger(topic.order) || typeof topic.order !== 'number' || topic.order < 1 || !text(topic.title) || !text(topic.description) || !(topic.lessonStatus === 'planned' || topic.lessonStatus === 'available')) return fail()
      if (topicIds.has(topic.id) || topicOrders.has(topic.order)) return fail()
      topicIds.add(topic.id); topicOrders.add(topic.order)
    }
  }
  const result = value as Roadmap
  result.path.stages.sort((a, b) => a.order - b.order)
  result.path.stages.forEach(stage => stage.topics.sort((a, b) => a.order - b.order))
  return result
}
