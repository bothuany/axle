// The tour player's state, the card resolution on a drawn flow, the review as a tour and the geometry: all pure files,
// run under plain Node (`npm test` in ui/).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { captionParts, idle, MAX_NOTES, reduce, stepMark } from '../src/tour/player.ts'
import { cardAt, cardOfTable, pathTo, resolveStep, samePath } from '../src/tour/cards.ts'
import { captionPlace, firstLine, glidePath, highlightedLines, lineY } from '../src/tour/geometry.ts'
import { rangesOf, reviewSignature, tourFromChanges } from '../src/tour/review.ts'
import { sanitizeNote, sanitizeStep, sanitizeTour } from '../src/tour/sanitize.ts'

const step = (title, extra = {}) => ({ title, caption: `about ${title}`, state: 'ok', ...extra })
const tour = (n, extra = {}) => ({ id: 't1', title: 'A tour', origin: 'file', source: 'file', start: 0, steps: Array.from({ length: n }, (_, i) => step(`s${i + 1}`)), ...extra })
const play = (...actions) => actions.reduce(reduce, idle)

// ---- the reducer ---------------------------------------------------------------------------------------

test('a tour starts on its first step and steps by hand: no wrap, no timer', () => {
  let s = play({ type: 'start', tour: tour(3) })
  assert.equal(s.index, 0)
  s = reduce(s, { type: 'back' })
  assert.equal(s.index, 0, 'back stops at the first step')
  s = play({ type: 'start', tour: tour(3) }, { type: 'next' }, { type: 'next' }, { type: 'next' }, { type: 'next' })
  assert.equal(s.index, 2, 'next stops at the last step')
})

test('start honours the tour\'s start step, clamped, and a tour without steps plays nothing', () => {
  assert.equal(play({ type: 'start', tour: tour(5, { start: 3 }) }).index, 3)
  assert.equal(play({ type: 'start', tour: tour(2, { start: 9 }) }).index, 1)
  assert.equal(play({ type: 'start', tour: tour(2, { start: -4 }) }).index, 0)
  assert.equal(play({ type: 'start', tour: tour(0) }), idle)
})

test('pause lifts the spotlight, and moving on or resuming puts it back', () => {
  let s = play({ type: 'start', tour: tour(3) }, { type: 'pause' })
  assert.equal(s.paused, true)
  assert.equal(reduce(s, { type: 'resume' }).paused, false)
  s = reduce(s, { type: 'next' })
  assert.deepEqual([s.index, s.paused], [1, false])
  assert.equal(reduce(s, { type: 'toggle' }).paused, true)
  // A pause with no tour is nothing.
  assert.equal(reduce(idle, { type: 'pause' }), idle)
})

test('goto jumps, clamped (the 1-9 keys)', () => {
  const s = play({ type: 'start', tour: tour(4) }, { type: 'goto', index: 2 })
  assert.equal(s.index, 2)
  assert.equal(reduce(s, { type: 'goto', index: 99 }).index, 3)
  assert.equal(reduce(s, { type: 'goto', index: Number.NaN }).index, 0)
})

test('a new tour replaces the one playing; end only closes the tour it names', () => {
  const s = play({ type: 'start', tour: tour(3) }, { type: 'next' }, { type: 'start', tour: tour(2, { id: 't2' }) })
  assert.deepEqual([s.tour.id, s.index], ['t2', 0])
  assert.equal(reduce(s, { type: 'end', id: 't1' }), s, 'a late end of the replaced tour leaves the new one alone')
  assert.equal(reduce(s, { type: 'end', id: 't2' }), idle)
  assert.equal(reduce(s, { type: 'exit' }), idle)
})

test('the host can move the reader, or deliver a step that was resolved late', () => {
  const s = play({ type: 'start', tour: tour(3, { steps: [step('a'), step('b', { state: 'missing' }), step('c')] }) })
  const moved = reduce(s, { type: 'step', id: 't1', index: 2 })
  assert.equal(moved.index, 2)
  const late = reduce(s, { type: 'step', id: 't1', index: 1, step: step('b', { state: 'ok' }) })
  assert.equal(late.index, 0, 'a late step does not jump')
  assert.equal(late.tour.steps[1].state, 'ok')
  assert.equal(reduce(s, { type: 'step', id: 'other', index: 2 }), s)
  assert.equal(reduce(s, { type: 'step', id: 't1', index: 7 }), s)
})

test('notes hang on their step, ten at most', () => {
  let s = play({ type: 'start', tour: tour(2) })
  for (let i = 0; i < MAX_NOTES + 3; i++) s = reduce(s, { type: 'note', id: 't1', index: 1, note: { text: `n${i}`, by: 'agent', at: i } })
  assert.equal(s.tour.steps[1].notes.length, MAX_NOTES)
  assert.equal(s.tour.steps[1].notes.at(-1).text, `n${MAX_NOTES + 2}`)
  assert.equal(s.tour.steps[0].notes, undefined)
})

test('the review shrinks as cards are kept: the index stays in range, and an empty list ends the tour', () => {
  let s = play({ type: 'start', tour: tour(3, { source: 'review', id: 'review' }) }, { type: 'goto', index: 2 })
  s = reduce(s, { type: 'steps', steps: [step('a'), step('b')] })
  assert.equal(s.index, 1)
  s = reduce(s, { type: 'steps', steps: [step('a')] })
  assert.equal(s.index, 0)
  assert.equal(reduce(s, { type: 'steps', steps: [] }), idle)
  assert.equal(reduce(idle, { type: 'steps', steps: [step('x')] }), idle)
})

test('the step list marks each state', () => {
  assert.equal(stepMark(step('a')).glyph, '✓')
  assert.equal(stepMark(step('a', { state: 'moved' })).glyph, '↪')
  assert.equal(stepMark(step('a', { state: 'missing' })).glyph, '⚠')
  assert.equal(stepMark(step('a', { state: 'offflow' })).glyph, '⧉')
  assert.equal(stepMark(step('a', { drift: true })).glyph, 'Δ', 'drift shows over ok')
})

test('a caption is text with `code` spans, never markup', () => {
  assert.deepEqual(captionParts('Freezes `price` here'), [{ text: 'Freezes ', code: false }, { text: 'price', code: true }, { text: ' here', code: false }])
  assert.deepEqual(captionParts('<img src=x onerror=1>'), [{ text: '<img src=x onerror=1>', code: false }])
  assert.deepEqual(captionParts('unclosed `tick'), [{ text: 'unclosed ', code: false }, { text: 'tick', code: true }])
})

// ---- which card a step points at ---------------------------------------------------------------------------

const node = (key, file, startLine, endLine, children = [], extra = {}) => ({ key, symbolId: null, label: key, sub: '', kind: 'method', file, startLine, endLine, code: '', children: children.map(n => ({ callLine: startLine, edgeKind: 'call', node: n })), ...extra })
// POST /orders: controller 10-30 calls service 40-90, which calls a repository 5-20 and a table card; billing sits in another file.
const repo = node('p3', 'C:\\w\\Repo.cs', 5, 20)
const table = node('p4', null, 0, 0, [], { kind: 'db', schema: { entity: 'Order', table: 'orders' } })
const service = node('p2', 'C:\\w\\Service.cs', 40, 90, [repo, table])
const inner = node('p9', 'C:\\w\\Service.cs', 60, 70)
const root = node('p1', 'C:\\w\\Controller.cs', 10, 30, [service])
const callers = node('u1', 'C:\\w\\Caller.cs', 1, 9, [node('p1b', 'C:\\w\\Controller.cs', 10, 30)])
service.children.push({ callLine: 62, edgeKind: 'call', node: inner })
const at = (file, startLine, extra = {}) => step('x', { at: { file, startLine, endLine: startLine, label: 'x' }, ...extra })

test('a line resolves to the innermost drawn card, whatever the path\'s spelling', () => {
  assert.equal(cardAt([root], 'c:/w/Controller.cs', 12)?.key, 'p1')
  assert.equal(cardAt([root], 'c:/w/Service.cs', 50)?.key, 'p2')
  assert.equal(cardAt([root], 'c:/w/Service.cs', 65)?.key, 'p9', 'a card inside a card wins')
  assert.equal(cardAt([root], 'c:/w/Service.cs', 200), undefined)
  assert.ok(samePath('C:\\x\\a.cs', 'c:/x/a.cs'))
})

test('a table step finds the database card by table name', () => {
  assert.equal(cardOfTable([root], 'ORDERS')?.key, 'p4')
  assert.equal(cardOfTable([root], 'users'), undefined)
})

test('resolveStep: a card, a peek for code off the flow, none for intros and missing code', () => {
  assert.deepEqual(resolveStep([root], at('C:\\w\\Service.cs', 45)), { kind: 'card', node: service })
  assert.equal(resolveStep([root], step('intro')).kind, 'none', 'a step with only a caption points at nothing')
  assert.equal(resolveStep([root], at('C:\\w\\Billing.py', 4)).kind, 'none', 'off the flow and nothing to peek at')
  assert.equal(resolveStep([root], at('C:\\w\\Billing.py', 4, { state: 'offflow', peek: { code: 'def f(): ...', startLine: 4 } })).kind, 'peek')
  assert.equal(resolveStep([root], at('C:\\w\\Service.cs', 45, { state: 'missing' })).kind, 'none', 'a missing step never points at a card')
  assert.equal(resolveStep([root], step('t', { at: { file: '', startLine: 0, endLine: 0, label: 't', table: 'orders' } })).node?.key, 'p4')
})

test('callers count only when they are among the trees', () => {
  const caller = at('C:\\w\\Caller.cs', 3)
  assert.equal(resolveStep([root, null], caller).kind, 'none')
  assert.equal(resolveStep([root, callers], caller).node?.key, 'u1')
})

test('the same method drawn twice: the card the review started on stays the one', () => {
  const copy = node('p1b', 'C:\\w\\Controller.cs', 10, 30)
  assert.equal(resolveStep([root, callers], at('C:\\w\\Controller.cs', 12)).node.key, 'p1', 'first drawn by default')
  assert.equal(resolveStep([root, callers], at('C:\\w\\Controller.cs', 12), 'p1b').node.key, 'p1b', 'the hint wins while it still holds the line')
  assert.equal(resolveStep([root], at('C:\\w\\Controller.cs', 12), 'gone').node.key, 'p1', 'a stale hint falls back')
  void copy
})

test('pathTo lists the cards to unfold on the way to a folded one', () => {
  assert.deepEqual(pathTo(root, 'p3')?.map(n => n.key), ['p1', 'p2', 'p3'])
  assert.equal(pathTo(root, 'nope'), undefined)
  assert.equal(pathTo(null, 'p1'), undefined)
})

// ---- the review of changes as a tour ---------------------------------------------------------------------------

const changedNode = (key, label, extra = {}) => node(key, 'C:\\w\\Service.cs', 40, 90, [], { label, diff: { added: [41, 42, 43, 50, 60, 61, 70, 80], removed: [], plus: 8, minus: 2 }, ...extra })

test('the review has a step per changed card, in order, with the added lines as highlights', () => {
  const a = changedNode('p2', 'OrderService ▸ Place')
  const b = changedNode('p5', 'Repo ▸ Save', { diff: { added: [7], removed: [], plus: 1, minus: 0, source: 'git' } })
  const { tour: t, keys } = tourFromChanges([a, b])
  assert.deepEqual(keys, ['p2', 'p5'])
  assert.equal(t.source, 'review')
  assert.equal(t.steps[0].title, 'OrderService.Place')
  assert.deepEqual(t.steps[0].highlights, [[41, 43], [50, 50], [60, 61]], 'adjacent lines merge, three ranges at most')
  assert.match(t.steps[0].caption, /Agent edit: 8 lines added, 2 removed/)
  assert.match(t.steps[1].caption, /Uncommitted change: 1 line added/)
  assert.equal(tourFromChanges([node('x', 'f', 1, 2)]).tour.steps.length, 0, 'a card without a change is no step')
  assert.equal(rangesOf([]).length, 0)
})

test('the review signature changes when a card is kept (the list shrinks) or its numbers change', () => {
  const a = changedNode('p2', 'A')
  const b = changedNode('p5', 'B')
  assert.notEqual(reviewSignature([a, b]), reviewSignature([b]))
  assert.equal(reviewSignature([a, b]), reviewSignature([a, b]))
})

// ---- geometry --------------------------------------------------------------------------------------------

test('a line\'s y comes from the rows the card draws, so gaps in a skeleton do not skew it', () => {
  const rows = [{ no: 40 }, { gap: 12, from: 41 }, { no: 53 }, { no: 54 }]
  assert.equal(lineY(rows, 53, 50, 18), 50 + 2.5 * 18)
  assert.equal(lineY(rows, 45, 50, 18), undefined, 'a line inside a gap is not drawn: the card has to be expanded first')
})

test('highlights: the first line, and a capped list of lines', () => {
  assert.equal(firstLine([[71, 76], [20, 22]], 58), 20)
  assert.equal(firstLine(undefined, 58), 58)
  assert.deepEqual(highlightedLines([[3, 5], [5, 6]]), [3, 4, 5, 6])
  assert.equal(highlightedLines([[1, 99999]]).length, 80, 'a wrong range cannot build a huge selector')
  assert.deepEqual(highlightedLines([[6, 4]]), [4, 5, 6], 'a reversed range is read both ways')
})

test('the caption sits right of the card, else left, else below, and never outside the canvas', () => {
  const canvas = { w: 1000, h: 700 }
  assert.equal(captionPlace({ x: 100, y: 100, w: 400, h: 200 }, canvas).side, 'right')
  assert.equal(captionPlace({ x: 500, y: 100, w: 450, h: 200 }, canvas).side, 'left')
  assert.equal(captionPlace({ x: 20, y: 40, w: 960, h: 200 }, canvas).side, 'below')
  const over = captionPlace({ x: 20, y: 40, w: 960, h: 640 }, canvas)
  assert.equal(over.side, 'over')
  for (const p of [over, captionPlace({ x: 100, y: 690, w: 400, h: 200 }, canvas)]) {
    assert.ok(p.left >= 8 && p.left + 360 <= 1000 && p.top >= 8 && p.top + 150 <= 700 - 64 + 1, JSON.stringify(p))
  }
})

test('the cursor glides along a curve through its stops, ending exactly on the last', () => {
  const path = glidePath({ x: 0, y: 0 }, [{ x: 300, y: 0 }, { x: 300, y: 90 }])
  assert.deepEqual([path[0].offset, path.at(-1).offset], [0, 1])
  assert.deepEqual([path.at(-1).x, path.at(-1).y], [300, 90])
  assert.ok(path.length >= 4 && path[1].y !== 0, 'the first leg bows sideways')
  assert.ok(path.every((p, i) => i === 0 || p.offset >= path[i - 1].offset), 'offsets never go back')
  assert.equal(glidePath({ x: 5, y: 5 }, [{ x: 5, y: 5 }]).length, 2, 'no move, no detour')
})

// ---- what arrives from the host is rebuilt before it renders ---------------------------------------------------------

test('sanitize: a good tour comes through field by field, and unknown fields do not', () => {
  const raw = { ...tour(2), extra: '<img onerror=1>', agent: { label: 'Claude Code', color: '#ff9d7d', html: 'x' }, steps: [{ ...step('a', { at: { file: 'f.js', startLine: 3, endLine: 5, label: 'f', evil: 1 }, highlights: [[3, 4]], peek: { code: 'x', startLine: 1 } }), onClick: 'x' }, step('b')] }
  const t = sanitizeTour(raw)
  assert.deepEqual(Object.keys(t).sort(), ['agent', 'id', 'origin', 'source', 'start', 'steps', 'title'])
  assert.deepEqual(t.agent, { label: 'Claude Code', color: '#ff9d7d' })
  assert.deepEqual(Object.keys(t.steps[0]).sort(), ['at', 'caption', 'highlights', 'peek', 'state', 'title'])
  assert.deepEqual(t.steps[0].at, { file: 'f.js', startLine: 3, endLine: 5, label: 'f' })
})

test('sanitize: a tour with one step it cannot read plays nothing; ids and shapes are checked', () => {
  assert.equal(sanitizeTour({ ...tour(2), steps: [step('a'), { title: 'no caption' }] }), null)
  assert.equal(sanitizeTour({ ...tour(1), id: '' }), null)
  assert.equal(sanitizeTour({ ...tour(1), id: 7 }), null)
  assert.equal(sanitizeTour(null), null)
  assert.equal(sanitizeTour({ ...tour(1), steps: 'x' }), null)
  assert.equal(sanitizeTour({ ...tour(1), steps: Array.from({ length: 101 }, () => step('x')) }), null)
})

test('sanitize: the agent colour is a colour literal, nothing that could carry a url() or a second declaration', () => {
  for (const color of ['red', 'url(//evil)', '#fff; background: url(//evil)', 'var(--x)', '', 7]) assert.equal(sanitizeTour({ ...tour(1), agent: { label: 'a', color } }).agent, undefined, String(color))
  assert.deepEqual(sanitizeTour({ ...tour(1), agent: { label: 'a'.repeat(99), color: '#FFF' } }).agent, { label: 'a'.repeat(40), color: '#FFF' })
})

test('sanitize: lines, ranges and sizes are bounded', () => {
  const s = sanitizeStep({ caption: 'c'.repeat(5000), state: 'bogus', at: { file: 'f', startLine: -1, endLine: 2, label: 'l' }, highlights: [[5, 3], [0, 2], ['x'], [1e9, 2e9], [7], [8, 9], [10, 11]], peek: { code: 'z'.repeat(50_000), startLine: 2 } })
  assert.equal(s.caption.length, 2000)
  assert.equal(s.state, 'ok')
  assert.equal(s.at, undefined, 'a negative line is not a place')
  assert.deepEqual(s.highlights, [[3, 5]], 'a reversed range is read both ways, bad ones dropped, three looked at')
  assert.equal(s.peek.code.length, 20_000)
  assert.equal(sanitizeStep({ caption: 'c', peek: { code: 'x', startLine: 0 } }).peek, undefined)
  assert.equal(sanitizeStep('text'), null)
  assert.equal(sanitizeStep({ caption: 5 }), null)
})

test('sanitize: a note keeps its text, who wrote it and when', () => {
  assert.deepEqual(sanitizeNote({ text: 'a', by: 'user', at: 5, question: 'q', x: 1 }), { text: 'a', by: 'user', at: 5, question: 'q' })
  assert.deepEqual(sanitizeNote({ text: 'a', by: 'robot', at: 'now' }), { text: 'a', by: 'agent', at: 0 })
  assert.equal(sanitizeNote({ by: 'user' }), null)
  assert.equal(sanitizeNote({ text: 'x'.repeat(5000), by: 'agent', at: 1 }).text.length, 2000)
  const withNotes = sanitizeStep({ caption: 'c', notes: [...Array.from({ length: 12 }, (_, i) => ({ text: `n${i}`, by: 'agent', at: i })), 'junk'] })
  assert.equal(withNotes.notes.length, 10)
})

// ---- asking about a step -----------------------------------------------------------------------------------

test('a question pauses the tour on its step, the answer (a note) arrives on it, and a resume continues', () => {
  let s = play({ type: 'start', tour: tour(3) }, { type: 'next' }, { type: 'ask' })
  assert.deepEqual([s.index, s.paused, s.asking], [1, true, 'waiting'])
  s = reduce(s, { type: 'note', id: 't1', index: 0, note: { text: 'about another step', by: 'agent', at: 1 } })
  assert.equal(s.asking, 'waiting', 'a note on another step is not the answer')
  s = reduce(s, { type: 'note', id: 't1', index: 1, note: { text: 'because', by: 'agent', at: 2 } })
  assert.deepEqual([s.paused, s.asking, s.tour.steps[1].notes.length], [true, 'answered', 1])
  assert.equal(reduce(s, { type: 'resume', id: 'other' }), s, 'a resume for another tour is ignored')
  const back = reduce(s, { type: 'resume', id: 't1' })
  assert.deepEqual([back.paused, back.asking], [false, null])
  assert.deepEqual([reduce(s, { type: 'resume' }).paused, reduce(s, { type: 'resume' }).asking], [false, null], 'the reader presses play')
})

test('moving on, pausing and playing all end a question; there is nothing to ask without a tour', () => {
  const asked = play({ type: 'start', tour: tour(3) }, { type: 'ask' })
  assert.equal(reduce(asked, { type: 'next' }).asking, null)
  assert.equal(reduce(asked, { type: 'goto', index: 2 }).asking, null)
  assert.equal(reduce(asked, { type: 'toggle' }).asking, null)
  assert.equal(reduce(asked, { type: 'step', id: 't1', index: 2 }).asking, null, 'the agent moved the reader')
  assert.equal(reduce(idle, { type: 'ask' }), idle)
  assert.equal(reduce(asked, { type: 'exit' }), idle)
})
