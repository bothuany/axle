// The scripted session the agents tile plays: Claude is given a task, looks at the code, asks the `axle` MCP who is affected, asks before
// it edits, edits, runs the tests, and is done. What Axle shows about such a session (the dock row, the overlay) follows from here. It
// is a replay, not a model: the steps and the timing are fixed.
import { useSyncExternalStore } from 'react'
import { addSession, allSessions, clearSessions, updateSession, type DemoSession, type Todo } from './sessions'
import { bringIntoView, demo } from './store'

export const PROMPT = 'add discount codes to orders'
const MODEL = 'Sonnet 4.5'
const WINDOW = 200_000
const ID = 'claude-1'

/** One step in the list the tile shows: under way, done, waiting for a yes, or refused. */
export interface Line {
  text: string
  state: 'doing' | 'done' | 'waiting' | 'no'
}
export type Phase = 'idle' | 'working' | 'asking' | 'done' | 'declined'
interface Story {
  phase: Phase
  lines: Line[]
}

let story: Story = { phase: 'idle', lines: [] }
const listeners = new Set<() => void>()
const change = (patch: Partial<Story>) => {
  story = { ...story, ...patch }
  listeners.forEach(l => l())
}
function subscribe(cb: () => void) {
  listeners.add(cb)
  return () => {
    listeners.delete(cb)
  }
}
export function useStory<T>(select: (s: Story) => T): T {
  return useSyncExternalStore(subscribe, () => select(story))
}

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

/** Adds a step in progress and marks the one before it done. */
function begin(mine: number, text: string, state: Line['state'] = 'doing') {
  if (!alive(mine)) return
  change({ lines: [...story.lines.map(l => (l.state === 'doing' ? { ...l, state: 'done' as const } : l)), { text, state }] })
}
const settle = (mine: number, state: Line['state']) => {
  if (!alive(mine)) return
  change({ lines: story.lines.map((l, i) => (i === story.lines.length - 1 ? { ...l, state } : l)) })
}

export function start() {
  bringIntoView('agents-tile')
  if (story.phase !== 'idle') return
  const mine = ++run
  change({ phase: 'working', lines: [] })
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
  updateSession(ID, { state: 'working', since: Date.now(), prompt: PROMPT, activity: 'Thinking', todos: todos(0), unread: false, need: undefined, impact: undefined, usage: usage(9_800), cost: cost(9_800, 0.04) })
  await sleep(1000)
  const step = async (activity: string, text: string, ms: number, patch: Partial<DemoSession> = {}) => {
    if (!alive(mine)) return
    begin(mine, text)
    updateSession(ID, { activity, ...patch })
    await sleep(ms)
  }
  await step('axle find_entry_points', 'Asked axle which endpoints there are', 1000, { todos: todos(0), usage: usage(11_200) })
  await step('Reading OrderService.java', 'Read OrderService.java', 900, { todos: todos(1), usage: usage(14_600) })
  await step('axle impact', 'Asked axle who else reads the orders table', 1500, { usage: usage(19_300), cost: cost(19_300, 0.08) })
  if (!alive(mine)) return

  // The permission question: the session is blocked until someone answers, and the dock and the overlay say so.
  const files = data.edits.map(e => base(e.path))
  const need = { kind: 'approval' as const, source: 'permission' as const, text: `Wants to: Editing ${files.join(' and ')}`, at: Date.now() }
  begin(mine, `Wants to edit ${files.join(' and ')}`, 'waiting')
  change({ phase: 'asking' })
  updateSession(ID, { state: 'blocked', since: Date.now(), need, activity: undefined, todos: todos(2) })
  const yes = await new Promise<boolean>(resolve => {
    answer = resolve
  })
  answer = undefined
  if (!alive(mine)) return
  if (!yes) {
    settle(mine, 'no')
    updateSession(ID, { state: 'done', since: Date.now(), need: undefined, activity: undefined, unread: false })
    change({ phase: 'declined' })
    return
  }

  settle(mine, 'done')
  change({ phase: 'working' })
  for (const f of files) await step(`Editing ${f}`, `Edited ${f}`, 800, { state: 'working', since: Date.now(), need: undefined })
  if (!alive(mine)) return
  updateSession(ID, { todos: todos(3), usage: usage(27_900), cost: cost(27_900, 0.13) })
  await step('Running ./mvnw -q -pl orders-service test', 'Ran the orders tests: 14 passed', 2200)
  if (!alive(mine)) return

  // Stop: the turn is over. The flows it touched come from flow-view's turn impact, which the dock lists.
  const impact = data.agentImpact
  updateSession(ID, { state: 'done', since: Date.now(), todos: PLAN.map(text => ({ text, status: 'completed' as const })), activity: undefined, need: undefined, unread: true, impact, usage: usage(28_400) })
  const table = impact.tables?.[0]
  begin(mine, `Done. It touched ${impact.flows.length} flows${table ? ` and the ${table.table} table, which ${table.endpoints} endpoints use` : ''}`, 'done')
  change({ phase: 'done' })
}

/** The visitor's answer to the permission question. */
export const allow = () => answer?.(true)
export const deny = () => answer?.(false)

/** Back to the start: no agent. */
export function startOver() {
  run++
  answer?.(false)
  answer = undefined
  clearSessions()
  change({ phase: 'idle', lines: [] })
}

/** The flow a dock chip stands for (by its place in the turn's list), for the canvas tile to open. */
export const touchedFlowId = (index: number) => allSessions().find(s => s.id === ID)?.impact?.flows[index]?.id
