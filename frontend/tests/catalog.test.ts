import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { parseRoadmap } from '../src/modules/learning-paths/catalog.ts'

const fixture = () => JSON.parse(readFileSync(new URL('../../backend/data/curriculum.json', import.meta.url), 'utf8'))

test('delivery sorts stages and topics and preserves honest readiness', () => {
  const data = fixture()
  data.path.stages.reverse()
  data.path.stages[6].topics.reverse()
  const result = parseRoadmap(data)
  assert.deepEqual(result.path.stages.map(stage => stage.order), [1, 2, 3, 4, 5, 6, 7])
  assert.deepEqual(result.path.stages[0].topics.map(topic => topic.order), [1, 2, 3, 4, 5, 6])
  assert.ok(result.path.stages.every(stage => stage.diagnosticStatus === 'planned'))
})

test('malformed delivery is rejected rather than shown as partial success', () => {
  for (const change of [
    data => data.path.stages.pop(),
    data => { data.path.stages[1].id = data.path.stages[0].id },
    data => { data.path.stages[0].topics[0].stageId = 'wrong' },
    data => { data.path.stages[0].topics[1].order = 1 },
    data => { data.path.stages[1].diagnosticStatus = 'unsupported' },
    data => { data.schemaVersion = 'unexpected' },
  ]) {
    const data = fixture()
    change(data)
    assert.throws(() => parseRoadmap(data))
  }
  assert.throws(() => parseRoadmap(null))
})

test('an empty topic catalog is valid and is not a completed stage', () => {
  const data = fixture()
  data.path.stages[0].topics = []
  const result = parseRoadmap(data)
  assert.equal(result.path.stages[0].topics.length, 0)
  assert.equal(result.path.stages[0].diagnosticStatus, 'planned')
})
