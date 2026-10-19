// The agent's gaze on the canvas (src/gaze/trail.ts): events found on the drawn cards, the fading trail, the marker of each
// agent, and what is read off the flow. Pure, run under plain Node (`npm test` in ui/).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { cardsFor, fade, keep, KEEP, paint, sanitizeGaze, TRAIL_MIN, TRAIL_MS } from '../src/gaze/trail.ts'

const card = (key, file, startLine, endLine, children = []) => ({ key, file, startLine, endLine, label: key, children: children.map(node => ({ node })) })
// A flow: the controller calls the service's Place, which calls two helpers in the same file.
const tree = card('p0', 'C:\\shop\\Orders.cs', 10, 30, [card('p1', 'C:\\shop\\Service.cs', 5, 40, [card('p2', 'C:\\shop\\Service.cs', 50, 60), card('p3', 'C:\\shop\\Service.cs', 70, 90)])])
const trees = [tree, null]
const ev = (extra = {}) => ({ session: 's1', agent: { label: 'Claude', color: '#ff9d7d' }, act: 'read', file: 'c:/shop/Service.cs', at: 1000, ...extra })

test('an event lands on the innermost card holding its lines, on every card a range crosses, or on the whole file', () => {
  assert.deepEqual(cardsFor(trees, ev({ startLine: 52, endLine: 55 })).map(n => n.key), ['p2'])
  assert.deepEqual(cardsFor(trees, ev({ startLine: 30, endLine: 75 })).map(n => n.key), ['p1', 'p2', 'p3'])
  assert.deepEqual(cardsFor(trees, ev()).map(n => n.key), ['p1', 'p2', 'p3'], 'no lines: every card of the file')
  assert.deepEqual(cardsFor(trees, ev({ startLine: 200 })), [], 'lines outside every card')
  assert.deepEqual(cardsFor(trees, ev({ act: 'search', file: 'C:\\shop' })), [], 'a search lands on no card')
  assert.deepEqual(cardsFor(trees, ev({ file: 'C:/elsewhere/Service.cs', startLine: 52 })), [])
})

test('the trail: each visited card in the agent\'s colour, fading over a minute, with its read count; an edit stays solid', () => {
  const now = 1000 + TRAIL_MS / 2
  const p = paint([ev({ startLine: 52 }), ev({ startLine: 53, at: 2000 }), ev({ act: 'edit', startLine: 72 }), ev({ file: 'C:\\shop\\Orders.cs', startLine: 12, at: now })], trees, now)
  const by = Object.fromEntries(p.trail.map(t => [t.key, t]))
  assert.deepEqual(Object.keys(by).sort(), ['p0', 'p2', 'p3'])
  assert.equal(by.p2.reads, 2)
  assert.equal(by.p2.color, '#ff9d7d')
  assert.ok(by.p2.strength > TRAIL_MIN && by.p2.strength < 1)
  assert.equal(by.p0.strength, 1, 'just now: full strength')
  assert.deepEqual([by.p3.edited, by.p3.strength], [true, 1])
  assert.equal(fade(TRAIL_MS * 3), TRAIL_MIN)
  const later = paint([ev({ startLine: 52 }), ev({ act: 'edit', startLine: 72 })], trees, 1000 + TRAIL_MS * 2)
  assert.deepEqual(later.trail.map(t => t.key), ['p3'], 'an old read is gone, an old edit stays')
})

test('one marker per agent, on the card of its latest event; several agents each have their own', () => {
  const p = paint([
    ev({ startLine: 52 }),
    ev({ startLine: 75, at: 1100 }),
    ev({ session: 's2', agent: { label: 'Codex', color: '#7fe0d6' }, file: 'C:\\shop\\Orders.cs', startLine: 12, at: 1200 }),
    ev({ file: 'C:\\shop\\appsettings.json', at: 1300 }),
    ev({ act: 'edit', startLine: 55, at: 1400 }),
  ], trees, 1500)
  assert.deepEqual(p.markers.map(m => [m.session, m.key, m.line, m.edits]), [['s1', 'p2', 55, 1], ['s2', 'p0', 12, 0]])
  assert.deepEqual(p.agents.map(a => [a.label, a.color]), [['Claude', '#ff9d7d'], ['Codex', '#7fe0d6']])
})

test('elsewhere: files no drawn card holds, newest first, one entry per file; a search is its folder', () => {
  const p = paint([
    ev({ file: 'C:\\shop\\appsettings.json' }),
    ev({ act: 'search', file: 'C:\\shop\\src', at: 1100 }),
    ev({ file: 'C:\\shop\\Billing.cs', startLine: 3, at: 1200 }),
    ev({ file: 'C:\\shop\\appsettings.json', at: 1300 }),
    ev({ startLine: 52, at: 1400 }),
  ], trees, 1500)
  assert.deepEqual(p.elsewhere.map(x => [x.act, x.file.split('\\').pop()]), [['read', 'appsettings.json'], ['read', 'Billing.cs'], ['search', 'src']])
})

test('what the host sends is rebuilt: a bad colour, act or line drops the event or the field', () => {
  const ok = { session: 's', agent: { label: 'A'.repeat(90), color: '#abc' }, act: 'edit', file: '/w/a.ts', startLine: 4, endLine: 2, at: 5, extra: 'x' }
  assert.deepEqual(sanitizeGaze([ok]), [{ session: 's', agent: { label: 'A'.repeat(40), color: '#abc' }, act: 'edit', file: '/w/a.ts', startLine: 4, at: 5 }])
  assert.deepEqual(sanitizeGaze([
    { ...ok, agent: { label: 'x', color: 'red;background:url(//evil)' } },
    { ...ok, act: 'exec' },
    { ...ok, file: 42 },
    { ...ok, session: '' },
    null,
  ]), [])
  assert.equal(sanitizeGaze([{ ...ok, act: 'search', startLine: 3 }])[0].startLine, undefined)
  assert.deepEqual(sanitizeGaze('nope'), [])
})

test('the canvas keeps the newest events only', () => {
  const many = Array.from({ length: KEEP + 50 }, (_, i) => ev({ at: i }))
  const kept = keep(many.slice(0, 100), many.slice(100))
  assert.equal(kept.length, KEEP)
  assert.equal(kept[0].at, 50)
})
