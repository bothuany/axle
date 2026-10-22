// The canvas's load counter (src/loads.ts): the impact, timeline and edit-hook answers of a flow the user has already
// left must not land on the flow now shown. Pure, run under plain Node (`npm test` in ui/).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { loadCounter } from '../src/loads.ts'

const deferred = () => {
  let resolve, reject
  const promise = new Promise((res, rej) => [resolve, reject] = [res, rej])
  return { promise, resolve, reject }
}

test('an impact answer from an earlier load does not overwrite the current flow\'s impact', async () => {
  const loads = loadCounter()
  let impact = null
  const request = mine => {
    const d = deferred()
    const live = loads.whileCurrent(mine)
    const done = d.promise.then(v => live(() => impact = v), () => live(() => impact = 'failed'))
    return { ...d, done }
  }
  const a = request(loads.start()) // flow A opens and asks for its impact
  const b = request(loads.start()) // the user switches to flow B before A's answer arrives
  b.resolve({ label: 'B', items: ['b1'] })
  await b.done
  a.resolve({ label: 'A', items: ['a1', 'a2'] })
  await a.done
  assert.deepEqual(impact, { label: 'B', items: ['b1'] })
})

test('a failure of an earlier load does not clear what the current load filled in', async () => {
  const loads = loadCounter()
  let turns = []
  const first = loads.start()
  const second = loads.start()
  loads.whileCurrent(second)(() => turns = ['t1'])
  await Promise.reject(new Error('gone')).catch(() => loads.whileCurrent(first)(() => turns = []))
  assert.deepEqual(turns, ['t1'])
  assert.equal(loads.isCurrent(first), false)
  assert.equal(loads.isCurrent(second), true)
})
