// The page around the canvas: the hero, the endpoint picker and the four guided steps. The canvas itself is canvas.html in an
// iframe, loaded only when someone asks for it (it carries a code editor, several MB): the shell talks to it with `show` and
// `cursor` messages, the same ones the Axle editor sends its webview.
import './style.css'
import { entryLabel, serviceOf, type DemoData, type Entry, type Target, type ToCanvas, type ToShell } from './demo'
import type { FlowNode } from '../../protocol/flow'

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T
const data: DemoData = await fetch('./data/demo.json').then(r => r.json())

const frame = $<HTMLIFrameElement>('canvas')
const view = $('view')
const note = $('note')
const picker = $('picker')
const CHANGES: Target = { kind: 'changes', id: '1' }
let shown: Target | undefined
let noteTimer: ReturnType<typeof setTimeout> | undefined

const sameTarget = (a?: Target, b?: Target) => !!a && !!b && a.kind === b.kind && a.id === b.id
const entryOf = (route: string) => data.entries.find(e => e.http === route) ?? data.entries[0]

function say(text: string) {
  note.textContent = text
  note.classList.add('on')
  clearTimeout(noteTimer)
  noteTimer = setTimeout(() => note.classList.remove('on'), 6000)
}

function step(n: number) {
  document.querySelectorAll<HTMLElement>('.step').forEach(s => s.classList.toggle('on', Number(s.dataset.step) === n))
}

/** Shows a target on the canvas, loading the canvas page first when it has not been opened yet. */
function show(target: Target, label: string) {
  if (frame.hidden) {
    frame.hidden = false
    frame.addEventListener('load', () => view.classList.add('live'), { once: true })
    frame.src = `./canvas.html?t=${encodeURIComponent(target.kind === 'changes' ? 'changes' : target.id)}`
  } else if (!sameTarget(shown, target)) {
    const message: ToCanvas = { type: 'show', target, label }
    frame.contentWindow?.postMessage(message, location.origin)
  }
  shown = target
  document.querySelectorAll<HTMLElement>('.picker button').forEach(b => b.classList.toggle('on', target.kind === 'poly' && b.dataset.id === target.id))
}

const showEntry = (e: Entry) => show({ kind: 'poly', id: e.id }, entryLabel(e))
const showChanges = () => show(CHANGES, data.changes.label)

/** A card of the change set by its label, to point at once the canvas has drawn it. */
function find(n: FlowNode, label: string): FlowNode | undefined {
  if (n.label === label) return n
  for (const c of n.children) {
    const hit = find(c.node, label)
    if (hit) return hit
  }
}

/** The canvas asks its host and then frames the flow: what follows a `show` waits for that. */
const later = (fn: () => void, ms = 1100) => setTimeout(fn, ms)

// ---- pointing at things in the canvas ---------------------------------------------------------------------------------
// The canvas opens a flow two calls deep and the rest is a click or a pan away. The canvas page is same-origin, so a guided step
// can do that click and pan for the reader. All of it is best effort: if the canvas changes, the step still shows the flow.
const canvasDoc = () => frame.contentDocument

/** Opens a folded hop: the tag on a call line (`create_invoice`) that shows what the call reaches. */
function unfold(name: string) {
  canvasDoc()?.querySelectorAll<HTMLElement>('button.port.folded').forEach(b => {
    if (b.title === `Show ${name}`) b.click()
  })
}

/** Pans the canvas sideways by dragging its background, the way a hand would: `share` of the canvas width, negative to the right. */
function pan(share: number) {
  const win = frame.contentWindow as (Window & typeof globalThis) | null
  const pane = canvasDoc()?.querySelector<HTMLElement>('.react-flow__pane')
  if (!win || !pane) return
  const box = pane.getBoundingClientRect()
  const y = box.top + box.height * 0.9
  const dx = Math.round(box.width * share)
  const x0 = box.left + box.width / 2
  const fire = (target: EventTarget, type: string, x: number) =>
    target.dispatchEvent(new win.MouseEvent(type, { bubbles: true, cancelable: true, view: win, clientX: x, clientY: y, button: 0, buttons: type === 'mouseup' ? 0 : 1 }))
  fire(pane, 'mousedown', x0)
  const steps = 12
  for (let i = 1; i <= steps; i++) setTimeout(() => fire(win, 'mousemove', x0 + (dx * i) / steps), i * 16)
  setTimeout(() => fire(win, 'mouseup', x0 + dx), (steps + 1) * 16)
}

// ---- the endpoint picker ----------------------------------------------------------------------------------------------
const byService = new Map<string, Entry[]>()
// The service the demo starts in comes first.
const ORDER = ['orders-service', 'billing-service', 'shipping-service']
const rank = (e: Entry) => ORDER.indexOf(serviceOf(e)) + 1 || ORDER.length + 1
for (const e of [...data.entries].sort((a, b) => rank(a) - rank(b))) byService.set(serviceOf(e), [...(byService.get(serviceOf(e)) ?? []), e])
for (const [service, entries] of byService) {
  const group = document.createElement('div')
  group.className = 'group'
  const title = document.createElement('h3')
  title.textContent = service
  group.append(title)
  for (const e of entries) {
    const [verb, ...path] = e.http.split(' ')
    const b = document.createElement('button')
    b.type = 'button'
    b.dataset.id = e.id
    const v = document.createElement('span')
    v.className = `verb ${verb.toLowerCase()}`
    v.textContent = verb
    const route = document.createElement('span')
    route.className = 'route'
    route.textContent = path.join(' ') || entryLabel(e)
    b.append(v, route)
    b.addEventListener('click', () => {
      step(1)
      showEntry(e)
    })
    group.append(b)
  }
  picker.append(group)
}

// ---- steps and the hero button ----------------------------------------------------------------------------------------
$('impact-count').textContent = String(data.changes.impact.items.length)

function openCanvas() {
  $('stage').scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' })
  if (frame.hidden) showEntry(entryOf('POST /orders'))
}
$('try').addEventListener('click', openCanvas)
$('open').addEventListener('click', () => showEntry(entryOf('POST /orders')))

$('go-http').addEventListener('click', () => {
  step(2)
  showEntry(entryOf('POST /orders'))
  // Open the HTTP? hop into billing and the topic? hop into shipping, then bring the far end into view.
  later(() => {
    unfold('create_invoice')
    unfold('OrderEvents.onOrderPlaced')
    unfold('onOrderPlaced')
  }, 1400)
  later(() => pan(-0.5), 2000)
})

$('go-change').addEventListener('click', () => {
  step(3)
  showChanges()
  const card = find(data.changes.root, 'OrderService.applyDiscount')
  if (card?.file) {
    const cursor: ToCanvas = { type: 'cursor', file: card.file, line: card.startLine + 1 }
    later(() => frame.contentWindow?.postMessage(cursor, location.origin))
  }
})

$('go-table').addEventListener('click', () => {
  step(4)
  showChanges()
  // Best effort: the canvas is same-origin, so it can be framed on the first card (the table) and its impact list opened for the reader.
  later(() => canvasDoc()?.querySelector<HTMLElement>('button[aria-label="Fit view"]')?.click(), 1200)
  later(() => canvasDoc()?.querySelector<HTMLElement>('.chip.impact.hot')?.click(), 1800)
})

window.addEventListener('message', e => {
  if (e.origin !== location.origin || e.source !== frame.contentWindow) return
  const m = e.data as ToShell
  if (m?.source === 'axle-canvas' && m.type === 'note') say(m.text)
})

// A step that is folded away opens by its title.
document.querySelectorAll<HTMLElement>('.step h2').forEach(h => {
  h.addEventListener('click', () => {
    const li = h.closest<HTMLElement>('.step')
    if (!li || li.classList.contains('on')) return
    const go = li.querySelector<HTMLElement>('.go')
    if (go) go.click()
    else step(Number(li.dataset.step))
  })
})
