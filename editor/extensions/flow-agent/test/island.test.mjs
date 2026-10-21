// The desktop status island's own rules: where it may sit and when it shows. The code lives in the core patch
// (src/vs/platform/axleDesktop/common/axleIsland.ts has no imports), so this reads it from the added lines of
// editor/patches/flow-desktop.patch and runs exactly that.
import { test, before } from 'node:test'
import assert from 'node:assert/strict'
import { transform } from 'esbuild'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const PATCH = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'patches', 'flow-desktop.patch')
const FILE = 'src/vs/platform/axleDesktop/common/axleIsland.ts'

let i
before(async () => {
	const lines = []
	let inside = false
	for (const line of readFileSync(PATCH, 'utf8').split(/\r?\n/)) {
		if (line.startsWith('diff --git ')) {
			inside = line.endsWith(` b/${FILE}`)
		} else if (inside && line.startsWith('+') && !line.startsWith('+++')) {
			lines.push(line.slice(1))
		}
	}
	assert.ok(lines.length > 50, 'the patch holds axleIsland.ts')
	const { code } = await transform(lines.join('\n'), { loader: 'ts', format: 'esm' })
	i = await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`)
})

const area = { x: 0, y: 0, width: 1920, height: 1040 }
const size = { width: 300, height: 40 }

test('clamp: a rectangle inside the area stays, one outside comes back whole', () => {
	assert.deepEqual(i.clampRect({ x: 100, y: 50, ...size }, area), { x: 100, y: 50, ...size })
	assert.deepEqual(i.clampRect({ x: -500, y: -20, ...size }, area), { x: 0, y: 0, ...size })
	assert.deepEqual(i.clampRect({ x: 5000, y: 5000, ...size }, area), { x: 1620, y: 1000, ...size })
	// An area with an offset (a second monitor to the left, a taskbar on top).
	const left = { x: -1280, y: 40, width: 1280, height: 984 }
	assert.deepEqual(i.clampRect({ x: -1400, y: 0, ...size }, left), { x: -1280, y: 40, ...size })
	// Bigger than the area: as much as fits, from the corner.
	assert.deepEqual(i.clampRect({ x: 50, y: 50, width: 3000, height: 40 }, area), { x: 0, y: 50, width: 1920, height: 40 })
})

test('spots: remembered as a fraction of the width and a distance from the top, so a new resolution keeps the place', () => {
	const rect = { x: 810, y: 100, ...size }
	const spot = i.rectToSpot(rect, area)
	assert.equal(spot.cx, 0.5)
	assert.equal(spot.y, 100)
	assert.deepEqual(i.spotToRect(spot, size, area), rect)
	const small = { x: 0, y: 0, width: 1280, height: 720 }
	assert.deepEqual(i.spotToRect(spot, size, small), { x: 490, y: 100, ...size })
	// A smaller display than the spot's y: pulled up so the island is still on it.
	assert.equal(i.spotToRect({ cx: 0.5, y: 900 }, size, small).y, 680)
	// Growing (the hover list) around the same centre stays on screen at the edge.
	assert.equal(i.spotToRect({ cx: 1, y: 0 }, { width: 400, height: 200 }, area).x, 1520)
})

test('spots: malformed stored values are no spot, extremes are limited', () => {
	assert.equal(i.readSpot(undefined), undefined)
	assert.equal(i.readSpot({ cx: 'a', y: 1 }), undefined)
	assert.equal(i.readSpot({ cx: NaN, y: 1 }), undefined)
	assert.deepEqual(i.readSpot({ cx: 4, y: -9 }), { cx: 1, y: 0 })
})

const d1 = { id: 1, workArea: { x: 0, y: 0, width: 1920, height: 1040 } }
const d2 = { id: 2, workArea: { x: 1920, y: 0, width: 1280, height: 1024 } }

test('placement: the last display the user dropped it on wins while it exists, else the chosen display', () => {
	const spots = { 1: { cx: 0.2, y: 10 }, 2: { cx: 0.8, y: 30 } }
	assert.deepEqual(i.resolvePlacement(spots, '2', [d1, d2], d1), { display: d2, spot: spots[2] })
	// Display 2 unplugged: back to the chosen display's own spot, clamped by the caller.
	assert.deepEqual(i.resolvePlacement(spots, '2', [d1], d1), { display: d1, spot: spots[1] })
	// Nothing remembered for the chosen display: the settings' own placement (no spot).
	assert.equal(i.resolvePlacement({}, undefined, [d1, d2], d1), undefined)
	assert.equal(i.resolvePlacement({ 2: spots[2] }, undefined, [d1, d2], d1), undefined)
})

test('displays: a rectangle belongs to the display that holds most of it', () => {
	assert.equal(i.displayForRect({ x: 1800, y: 10, width: 300, height: 40 }, [d1, d2]).id, 2)
	assert.equal(i.displayForRect({ x: 1700, y: 10, width: 300, height: 40 }, [d1, d2]).id, 1)
	assert.equal(i.displayForRect({ x: 0, y: 0, width: 10, height: 10 }, []), undefined)
})

test('visibility: no agents hides, an Axle window with focus hides, each by its setting', () => {
	const on = { noAgents: true, axleFocused: true }
	assert.equal(i.islandVisible({ hasAgents: true, autoHide: on, axleFocused: false }), true)
	assert.equal(i.islandVisible({ hasAgents: true, autoHide: on, axleFocused: true }), false)
	assert.equal(i.islandVisible({ hasAgents: false, autoHide: on, axleFocused: false }), false)
	assert.equal(i.islandVisible({ hasAgents: true, autoHide: { noAgents: true, axleFocused: false }, axleFocused: true }), true)
	assert.equal(i.islandVisible({ hasAgents: false, autoHide: { noAgents: false, axleFocused: true }, axleFocused: false }), true)
})

/** Drives the gate like the main process: events at times, and a settle at each moment something is due. */
function run(events, delays = i.FOCUS_DELAYS) {
	let gate = i.INITIAL_GATE
	const shown = []
	let now = 0
	for (const [at, focused] of events) {
		// Anything due before this event settles first.
		for (let wait = i.focusWait(gate, now, delays); wait !== undefined && now + wait <= at; wait = i.focusWait(gate, now, delays)) {
			now += wait
			gate = i.settleFocus(gate, now, delays)
			shown.push([now, gate.focused])
		}
		now = at
		gate = i.settleFocus(i.observeFocus(gate, focused, now), now, delays)
		shown.push([now, gate.focused])
	}
	for (let wait = i.focusWait(gate, now, delays); wait !== undefined; wait = i.focusWait(gate, now, delays)) {
		now += wait
		gate = i.settleFocus(gate, now, delays)
		shown.push([now, gate.focused])
	}
	return { gate, shown }
}

test('focus: focusing Axle hides after the short delay, leaving it shows after the longer one', () => {
	const { gate, shown } = run([[0, true], [1000, false]])
	assert.deepEqual(shown.filter(([, f], k, a) => k === 0 || f !== a[k - 1][1]), [[0, false], [120, true], [1400, false]])
	assert.equal(gate.focused, false)
	assert.equal(gate.pending, undefined)
})

test('focus: alt-tabbing through Axle does not flicker', () => {
	// Away from Axle (settled), then focus lands on Axle for 60 ms and goes again: it never hides.
	let gate = i.settleFocus(i.observeFocus(i.INITIAL_GATE, false, 0), 0)
	gate = i.observeFocus(gate, true, 1000)
	assert.equal(gate.focused, false)
	gate = i.settleFocus(gate, 1060)
	assert.equal(gate.focused, false, 'not yet')
	gate = i.observeFocus(gate, false, 1060)
	assert.equal(gate.pending, undefined, 'the blip is forgotten')
	assert.equal(i.focusWait(gate, 1060), undefined)
	// And the other way: Axle is focused, a switcher blurs it for 200 ms, it comes back: the island stays hidden.
	const focused = { focused: true }
	let g = i.observeFocus(focused, false, 5000)
	g = i.settleFocus(g, 5200)
	assert.equal(g.focused, true)
	g = i.observeFocus(g, true, 5200)
	assert.deepEqual(g, focused)
})

test('focus: a blur then a focus on another Axle window is one unbroken focus', () => {
	// Blur at 0 and focus at 30 ms: the settled value never moved.
	let g = i.observeFocus({ focused: true }, false, 0)
	g = i.observeFocus(g, true, 30)
	assert.deepEqual(g, { focused: true })
})

test('focus: the wait is what is left of the delay, and nothing is due when nothing changed', () => {
	assert.equal(i.focusWait(i.INITIAL_GATE, 0), undefined)
	const g = i.observeFocus(i.INITIAL_GATE, true, 1000)
	assert.equal(i.focusWait(g, 1000), i.FOCUS_DELAYS.hideMs)
	assert.equal(i.focusWait(g, 1100), i.FOCUS_DELAYS.hideMs - 100)
	assert.equal(i.focusWait(g, 5000), 0)
	// A repeated report of the same change keeps its start.
	assert.equal(i.observeFocus(g, true, 1090), g)
})
