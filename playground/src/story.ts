// The scripted session the page plays: Claude is given a task, looks at the code, asks the `axle` MCP who is affected, asks before it edits,
// edits, runs the tests, and is done. What Axle shows about such a session (the dock row, the overlay, the flows the turn touched, the
// change on the canvas) follows from here. It is a replay, not a model: the words and the timing are fixed.
import { addSession, allSessions, clearSessions, updateSession, type DemoSession, type Todo } from './sessions'
import { IDLE_CAPTION, demo, entries, get, openEntry, set, startEntry } from './store'

export const PROMPT = 'add discount codes to orders'
const MODEL = 'Sonnet 4.5'
const WINDOW = 200_000
const ID = 'claude-1'

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))
const base = (p: string) => p.split('/').at(-1)!
const tokens = (n: number) => ({ input: Math.round(n * 0.18), output: Math.round(n * 0.04), cacheRead: Math.round(n * 0.72), cacheWrite: Math.round(n * 0.06) })
const usage = (used: number) => ({ used, size: WINDOW, percent: Math.round((used / WINDOW) * 100), model: MODEL })
const cost = (used: number, usd: number) => ({ session: { tokens: tokens(used), usd }, scope: 'session', usdSource: 'an estimate from list prices' })

const PLAN = ['Find where an order is placed', 'Check what the change reaches', 'Add discount_code and apply it in OrderService', 'Run the orders tests']
const todos = (done: number): Todo[] => PLAN.map((text, i) => ({ text, status: i < done ? 'completed' : i === done ? 'in_progress' : 'pending' }))

/** A run's token: a run that was reset (Start over) stops talking. */
let run = 0
let answer: ((yes: boolean) => void) | undefined

const alive = (mine: number) => mine === run
const say = (mine: number, caption: string, patch: Partial<DemoSession> = {}) => {
  if (!alive(mine)) return
  set({ caption })
  if (Object.keys(patch).length) updateSession(ID, patch)
}

/** One tool call: the dock row says what it does, the caption says it in words. */
async function step(mine: number, activity: string, caption: string, ms: number, patch: Partial<DemoSession> = {}) {
  say(mine, caption, { activity, ...patch })
  await sleep(ms)
}

export function start() {
  // The whole stage in view: the canvas, the dock and the overlay at the top, and the caption with its buttons at the bottom.
  document.getElementById('stage')?.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'center' })
  if (get().phase !== 'idle') return
  const mine = ++run
  set({ phase: 'working', caption: 'Starting Claude Code in a terminal…' })
  addSession({ id: ID, cli: 'claude', name: 'Claude 1', state: 'starting', since: Date.now(), todos: [], unread: false })
  void play(mine)
}

async function play(mine: number) {
  const data = demo()
  await sleep(900)
  if (!alive(mine)) return
  updateSession(ID, { state: 'idle', since: Date.now(), usage: usage(8_400) })
  await sleep(500)
  if (!alive(mine)) return
  // UserPromptSubmit: a new turn.
  say(mine, `Task: “${PROMPT}”`, { state: 'working', since: Date.now(), prompt: PROMPT, activity: 'Thinking', todos: todos(0), unread: false, need: undefined, impact: undefined, usage: usage(9_800), cost: cost(9_800, 0.04) })
  await sleep(1300)
  await step(mine, 'axle find_entry_points', 'Asking axle which endpoints there are…', 1000, { todos: todos(0), usage: usage(11_200) })
  await step(mine, 'Reading OrderService.java', 'Reading OrderService.java…', 900, { todos: todos(1), usage: usage(14_600) })
  await step(mine, 'axle impact', 'Asking axle who else reads the orders table…', 1500, { usage: usage(19_300), cost: cost(19_300, 0.08) })
  if (!alive(mine)) return

  // The permission question: the session is blocked until someone answers, and the dock, the overlay and the caption all say so.
  const files = data.edits.map(e => base(e.path))
  const need = { kind: 'approval' as const, source: 'permission' as const, text: `Wants to: Editing ${files.join(' and ')}`, at: Date.now() }
  set({ phase: 'asking', caption: `Claude wants to edit ${files.join(' and ')}. The notch and the Agents dock say the same.` })
  updateSession(ID, { state: 'blocked', since: Date.now(), need, activity: undefined, todos: todos(2) })
  const yes = await new Promise<boolean>(resolve => {
    answer = resolve
  })
  answer = undefined
  if (!alive(mine)) return
  if (!yes) {
    updateSession(ID, { state: 'done', since: Date.now(), need: undefined, activity: undefined, unread: false })
    set({ phase: 'declined', caption: 'Nothing was changed: Claude stops and waits for what you would rather it do.' })
    return
  }

  set({ phase: 'working' })
  for (const f of files) await step(mine, `Editing ${f}`, `Editing ${f}…`, 800, { state: 'working', since: Date.now(), need: undefined })
  if (!alive(mine)) return
  // Both files are written: the canvas draws the changed code.
  set({ edited: true, kept: false })
  updateSession(ID, { todos: todos(3), usage: usage(27_900), cost: cost(27_900, 0.13) })
  await step(mine, 'Running ./mvnw -q -pl orders-service test', 'Running the orders tests…', 2400)
  if (!alive(mine)) return

  // Stop: the turn is over. The flows it touched come from flow-view's turn impact, which the dock lists.
  const impact = data.agentImpact
  const table = impact.tables?.[0]
  updateSession(ID, { state: 'done', since: Date.now(), todos: PLAN.map(text => ({ text, status: 'completed' as const })), activity: undefined, need: undefined, unread: true, impact, usage: usage(28_400) })
  set({ phase: 'done', caption: `Done. The change touched ${impact.flows.length} flows${table ? ` and the ${table.table} table, which ${table.endpoints} endpoints use` : ''}.` })
}

/** The visitor's answer to the permission question. */
export const allow = () => answer?.(true)
export const deny = () => answer?.(false)

/** Shows the change on the canvas: the order flow again, with the green and red of the change on its cards. */
export function review() {
  if (!get().edited) return
  const flow = allSessions().find(s => s.id === ID)?.impact?.flows.findIndex(f => f.label === 'POST /orders') ?? -1
  openTurnFlow(Math.max(flow, 0))
}

/** A flow from the dock's “this turn touched” line: opens on the canvas with the change on its cards. */
export function openTurnFlow(index: number) {
  const flow = allSessions().find(s => s.id === ID)?.impact?.flows[index]
  const entry = flow && entries().find(e => e.id === flow.id)
  if (!entry) return
  openEntry(entry)
  updateSession(ID, { unread: false })
  set({ phase: 'review', caption: `${entry.http} with Claude's change on its cards: green is added, red is removed. Keep the change, or Undo it.` })
}

/** Keep on the canvas: the marks go, the code stays changed. */
export function keep() {
  set({ kept: true, phase: 'review', caption: 'Kept. The marks are gone and the code stays changed.' })
}

/** Back to the start: the code as committed, no agent, the order flow. */
export function startOver() {
  run++
  answer?.(false)
  answer = undefined
  clearSessions()
  const first = startEntry()
  set({ phase: 'idle', caption: IDLE_CAPTION, edited: false, kept: false })
  openEntry(first)
}

/** Undo on the canvas puts the code back; the story starts again. */
export const undo = startOver
