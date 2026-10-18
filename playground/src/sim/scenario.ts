// The scripted session the demo plays when Claude is started: it reads the code, asks the `axle` MCP who is affected, asks you before
// it edits, edits, runs the tests, and says what it did. Everything the real Axle shows about such a session (the dock row, the overlay
// at the top of the screen, the permission in the Harness view, the terminal, the files and the flow canvas) is driven from here.
// It is a replay, not a model: the words are fixed, and the terminal says so when it is asked for anything else.
import { attentionKind, notification, type Need } from '../../../editor/extensions/flow-agent/src/attention'
import type { AgentEdit } from '../demo'
import { C, ClaudeTui } from './claudeTui'
import { addSession, allSessions, updateSession, type DemoSession, type Todo } from './sessions'
import { registerTerminal } from './term'
import { demo, entries, get, openEntry, set, toast } from '../workbench/store'

export const PROMPT = 'add discount codes to orders: an optional code on the order cuts its total by 10% before it is saved and invoiced'
const MODEL = 'Sonnet 4.5'
const WINDOW = 200_000
const CWD = '~/harbor-goods'

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

/** What the visitor chose at a permission question, or what the demo chose for them. */
type Choice = 'yes' | 'always' | 'no'
interface Pending {
  choose: (c: Choice) => void
  /** What the Harness view's "Permission requests" lists. */
  file: string
  tool: string
  session: string
}
let pending: Pending | undefined
let autopilot = false
let running: string | undefined
let counter = 0

export const pendingPermission = () => pending
/** Plays the demo without waiting for the visitor: asks nothing, answers yes. */
export function setAutopilot(on: boolean) {
  autopilot = on
}
export const isRunning = () => running !== undefined

/** Allow (or deny) what the agent is asking for, from anywhere: the terminal, the Harness view, the notification. */
export function answerPermission(choice: Choice) {
  pending?.choose(choice)
}

const tokens = (n: number) => ({ input: Math.round(n * 0.18), output: Math.round(n * 0.04), cacheRead: Math.round(n * 0.72), cacheWrite: Math.round(n * 0.06) })

/** Focuses the terminal of a session, the way a click on its dock row or its overlay row does. */
export function focusSession(id: string) {
  set({ panel: true, panelTab: 'terminal', activeTerminal: id })
  updateSession(id, { unread: false })
}

const watched = (id: string) => {
  const s = get()
  return s.panel && s.panelTab === 'terminal' && s.activeTerminal === id
}

export function startClaude(): void {
  if (running) return focusSession(running)
  const id = `claude-${++counter}`
  const name = `Claude ${counter}`
  const tui = new ClaudeTui(id, CWD)
  registerTerminal(tui)
  tui.header(MODEL)
  tui.setFooter({ kind: 'prompt', text: '', placeholder: 'Try "add discount codes to orders"', hint: '? for shortcuts' })
  set(s => ({ terminals: [...s.terminals, { id, kind: 'claude', title: 'claude' }], activeTerminal: id, panel: true, panelTab: 'terminal' }))
  const base: DemoSession = { id, cli: 'claude', name, state: 'starting', since: Date.now(), todos: [], unread: false }
  addSession(base)
  // Claude Code's hooks start speaking as soon as it has: it is ready and waits for a prompt.
  void (async () => {
    await sleep(900)
    updateSession(id, { state: 'idle', since: Date.now(), usage: { used: 8_400, size: WINDOW, percent: 4, model: MODEL } })
    if (get().edited) {
      tui.say('Discount codes are already in this checkout. Undo the change on the flow canvas (the Undo button on a changed card) to run the demo again.')
      return
    }
    running = id
    try {
      await play(id, tui, name)
    } finally {
      running = undefined
    }
  })()
}

/** The need a permission question puts on the session (attention.ts words it: "Wants to: Editing Order.java"). */
function need(text: string): Need {
  return { kind: 'approval', source: 'permission', text, at: Date.now() }
}

function say(id: string, patch: Partial<DemoSession>) {
  updateSession(id, patch)
}

async function type(tui: ClaudeTui, text: string) {
  let typed = ''
  for (const ch of text) {
    typed += ch
    tui.setFooter({ kind: 'prompt', text: typed, hint: '? for shortcuts' })
    await sleep(ch === ' ' ? 34 : 20)
  }
}

/** One tool call: the dock row says what it is doing; the terminal shows the call and what it returned. */
async function step(id: string, tui: ClaudeTui, activity: string, wait: number, show: () => void, spinner = 'Working…') {
  say(id, { activity })
  tui.setFooter({ kind: 'prompt', text: '', hint: 'esc to interrupt', spinner: `✻ ${spinner} (esc to interrupt)` })
  await sleep(wait)
  show()
}

const base = (p: string) => p.split('/').at(-1)!

/** The permission question for an edit. Resolves with the choice; `always` is what "allow all edits during this session" answers. */
function ask(id: string, tui: ClaudeTui, edit: AgentEdit): Promise<Choice> {
  return new Promise(resolve => {
    const options = ['Yes', 'Yes, allow all edits during this session (shift+tab)', 'No, and tell Claude what to do differently (esc)']
    let selected = 0
    const show = () =>
      tui.setFooter({ kind: 'dialog', title: 'Edit file', file: edit.path, diff: tui.diffLines(edit), question: `Do you want to make this edit to ${C.bold}${base(edit.path)}${C.reset}?`, options, selected })
    const choose = (c: Choice) => {
      tui.onKey = undefined
      pending = undefined
      resolve(c)
    }
    pending = { choose, file: edit.path, tool: 'Edit', session: id }
    // Claude Code's PermissionRequest hook: the session is blocked until someone answers, and the dock, the overlay and the Harness view all say so.
    const n = need(`Wants to: Editing ${base(edit.path)}`)
    updateSession(id, { state: 'blocked', since: Date.now(), need: n, activity: undefined })
    const s = allSessions().find(x => x.id === id)!
    const note = notification({ ...s, need: n, state: 'blocked' }, { quiet: false, enabled: () => true, watched: watched(id) })
    if (note) toast(note.message, ['Show'])
    show()
    tui.onKey = key => {
      if (key === 'up') selected = Math.max(0, selected - 1)
      else if (key === 'down') selected = Math.min(2, selected + 1)
      else if (key === '1' || key === '2' || key === '3') return choose(['yes', 'always', 'no'][Number(key) - 1] as Choice)
      else if (key === 'escape') return choose('no')
      else if (key === 'enter') return choose(['yes', 'always', 'no'][selected] as Choice)
      show()
    }
    if (autopilot) void sleep(1400).then(() => choose('yes'))
  })
}

async function play(id: string, tui: ClaudeTui, name: string) {
  const data = demo()
  const edits = data.edits
  const todo = (texts: string[], done: number): Todo[] => texts.map((text, i) => ({ text, status: i < done ? 'completed' : i === done ? 'in_progress' : 'pending' }))
  const plan = ['Find where an order is placed', 'Check what the change reaches', 'Add discount_code and apply it in OrderService', 'Run the orders tests']
  const listed = entries().length

  await sleep(autopilot ? 400 : 1100)
  await type(tui, PROMPT)
  await sleep(450)
  // UserPromptSubmit: a new turn.
  say(id, { state: 'working', since: Date.now(), prompt: PROMPT, activity: 'Thinking', todos: [], unread: false, need: undefined, impact: undefined, usage: { used: 9_800, size: WINDOW, percent: 5, model: MODEL }, cost: { session: { tokens: tokens(9_800), usd: 0.04 }, prompt: { tokens: tokens(1_400), usd: 0.01 }, scope: 'session', usdSource: 'an estimate from list prices' } })
  tui.line(`${C.dim}> ${PROMPT}${C.reset}`)
  tui.line()
  tui.setFooter({ kind: 'prompt', text: '', hint: 'esc to interrupt', spinner: '✻ Thinking… (esc to interrupt)' })
  await sleep(1500)

  tui.say('I will look at how an order is placed first, and ask what else reads the orders table before I change it.')
  say(id, { todos: todo(plan, 0), usage: { used: 11_200, size: WINDOW, percent: 6, model: MODEL } })
  tui.tool('Update Todos', '', plan.map((t, i) => `${i === 0 ? '☒' : '☐'} ${t}`))

  await step(id, tui, 'axle find_entry_points', 1100, () => tui.tool('axle - find_entry_points', 'MCP', [`query: "orders"`, `${listed} entry points`, 'POST /orders      OrderController.place', 'GET  /orders      OrderController.list', 'GET  /orders/{id} OrderController.show', '… 2 more']), 'Searching…')
  say(id, { todos: todo(plan, 1), usage: { used: 14_600, size: WINDOW, percent: 7, model: MODEL } })

  await step(id, tui, 'Reading OrderController.java', 800, () => tui.tool('Read', 'orders-service/src/main/java/com/harborgoods/orders/OrderController.java', ['Read 38 lines']), 'Reading…')
  await step(id, tui, 'Reading OrderService.java', 800, () => tui.tool('Read', 'orders-service/src/main/java/com/harborgoods/orders/OrderService.java', ['Read 52 lines']), 'Reading…')
  await step(id, tui, 'axle impact', 1500, () => tui.tool('axle - impact', 'MCP', ['table: "orders"', 'table orders is read or written by 4 endpoints:', 'GET /orders, GET /orders/{id}, GET /reports/revenue (guess), POST /orders (writes)']), 'Checking who is affected…')
  say(id, { todos: todo(plan, 1), usage: { used: 19_300, size: WINDOW, percent: 10, model: MODEL }, cost: { session: { tokens: tokens(19_300), usd: 0.08 }, prompt: { tokens: tokens(10_900), usd: 0.05 }, scope: 'session', usdSource: 'an estimate from list prices' } })
  await step(id, tui, 'Reading Order.java', 700, () => tui.tool('Read', 'orders-service/src/main/java/com/harborgoods/orders/Order.java', ['Read 22 lines']), 'Reading…')

  tui.say('`orders` is shared by four endpoints, so I will keep the change small: a nullable `discount_code` column on `Order`, and the 10% taken off inside `OrderService.place`, before the save and the invoice call.')
  say(id, { todos: todo(plan, 2), activity: 'Thinking' })
  await sleep(1300)

  // The edits. The first asks; "allow all edits" lets the second go through.
  let always = false
  for (const edit of edits) {
    if (!always) {
      const choice = await ask(id, tui, edit)
      if (choice === 'no') {
        updateSession(id, { state: 'working', since: Date.now(), need: undefined, activity: 'Thinking' })
        tui.setFooter({ kind: 'prompt', text: '', hint: '? for shortcuts' })
        tui.line(`${C.red}⏺${C.reset} ${C.dim}Edit declined${C.reset}`)
        tui.line()
        tui.say('Understood. I have not changed anything. Tell me what you would rather I do.')
        updateSession(id, { state: 'done', since: Date.now(), unread: true, need: undefined, activity: undefined })
        return
      }
      always = choice === 'always'
      updateSession(id, { state: 'working', since: Date.now(), need: undefined, activity: `Editing ${base(edit.path)}` })
    } else updateSession(id, { activity: `Editing ${base(edit.path)}` })
    tui.setFooter({ kind: 'prompt', text: '', hint: always ? '⏵⏵ accept edits on (shift+tab to cycle)' : 'esc to interrupt', spinner: '✻ Editing… (esc to interrupt)' })
    await sleep(700)
    tui.edited(edit)
  }
  // Both files are written: the Explorer, the editors, Source Control and the canvas all see the change.
  set({ edited: true, kept: false })
  say(id, { todos: todo(plan, 3), usage: { used: 27_900, size: WINDOW, percent: 14, model: MODEL }, cost: { session: { tokens: tokens(27_900), usd: 0.13 }, prompt: { tokens: tokens(18_500), usd: 0.1 }, scope: 'session', usdSource: 'an estimate from list prices' } })

  await step(id, tui, 'Running ./mvnw -q -pl orders-service test', 2600, () => tui.tool('Bash', './mvnw -q -pl orders-service test', ['[INFO] Tests run: 14, Failures: 0, Errors: 0, Skipped: 0', '[INFO] BUILD SUCCESS']), 'Running tests…')

  // Stop: the turn is over. The flows it touched come from flow-view's turn impact, which the dock lists.
  tui.say('Done. An order can carry a `discountCode` now, and `OrderService.place` takes 10% off `totalCents` before it saves the order and asks billing for the invoice.')
  tui.para('- Order.java: `legacy_ref` is replaced by a nullable `discount_code` column. Check nothing still reads `legacy_ref`.')
  tui.para('- OrderService.java: new `applyDiscount`, called first in `place`.')
  tui.line()
  tui.para('The `orders` table changed, so GET /orders, GET /orders/{id} and GET /reports/revenue are affected too. I did not add a migration: this repo has none yet.')
  tui.line()
  tui.setFooter({ kind: 'prompt', text: '', placeholder: '', hint: '? for shortcuts' })
  updateSession(id, { state: 'done', since: Date.now(), todos: todo(plan, 4).map(t => ({ ...t, status: 'completed' as const })), activity: undefined, need: undefined, unread: true, impact: data.agentImpact, usage: { used: 28_400, size: WINDOW, percent: 14, model: MODEL } })
  const s = allSessions().find(x => x.id === id)
  // The turn is over and nobody has opened its answer: the dock, the overlay and a notification say so until someone looks.
  const note = s && notification({ ...s, unread: true }, { quiet: false, enabled: () => true, watched: false })
  if (note) toast(note.message, ['Show'])
  void name
}

/** A flow from the dock's "this turn touched" line: opens on the canvas with the change on its cards. */
export function openTurnFlow(sessionId: string, index: number) {
  const impact = allSessions().find(s => s.id === sessionId)?.impact
  const flow = impact?.flows[index]
  const entry = flow && entries().find(e => e.id === flow.id)
  if (entry) openEntry(entry)
}

/** Whether a session waits for the visitor (the harness view and the guide ask). */
export const waiting = () => allSessions().some(s => attentionKind(s) === 'approval')
