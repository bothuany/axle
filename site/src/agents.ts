// The Try page's agents: the app's own Agents dock page and its status island, in iframes, told about three agents at work on the
// demo project. The agents are written here (a fixed moment, not a live session); how they are ranked and what the island makes of
// them is flow-agent's own code (sessions.ts). Allowing the waiting one moves it on, the way the app would.
import type { AvatarKind } from '../../editor/extensions/flow-agent/src/desktopModel'
import type { DemoData } from './demo'
import { addSession, allSessions, clearSessions, dockList, islandModel, subscribeSessions, updateSession, type DemoSession } from './sessions'

const MIN = 60_000

function cast(data: DemoData, now: number): DemoSession[] {
  const edit = data.edits[0]?.path ?? 'orders-service/src/main/java/com/harborgoods/orders/OrderService.java'
  return [
    {
      id: 'billing',
      name: 'Codex',
      cli: 'codex',
      state: 'blocked',
      unread: true,
      since: now - 2 * MIN,
      need: { kind: 'approval', source: 'permission', text: 'Run pytest billing-service/tests', at: now - 40_000 },
      prompt: 'Make the invoice total include the discount.',
      todos: [
        { text: 'Read InvoiceService.issue', status: 'completed' },
        { text: 'Apply the discount to the total', status: 'completed' },
        { text: 'Run the billing tests', status: 'in_progress' },
      ],
      usage: { used: 61_000, size: 200_000, percent: 31, model: 'gpt-5.5' },
    },
    {
      id: 'orders',
      name: 'Claude Code',
      cli: 'claude',
      state: 'done',
      unread: true,
      since: now - 4 * MIN,
      prompt: 'Add discount codes to orders: a code on the order cuts its total before it is saved and invoiced.',
      todos: [
        { text: 'Add discount_code to Order', status: 'completed' },
        { text: `Apply it in ${edit.split('/').pop()}`, status: 'completed' },
      ],
      usage: { used: 84_000, size: 200_000, percent: 42, model: 'claude-opus-5-5' },
      impact: data.agentImpact,
    },
    {
      id: 'shipping',
      name: 'Claude Code',
      cli: 'claude',
      state: 'working',
      unread: false,
      since: now - 7 * MIN,
      activity: 'Editing ShipmentService.java',
      prompt: 'Schedule express shipments for orders over 100 euros.',
      todos: [
        { text: 'Read OrderEvents.onOrderPlaced', status: 'completed' },
        { text: 'Add an express option to Shipment', status: 'in_progress' },
        { text: 'Write a test for the threshold', status: 'pending' },
      ],
      usage: { used: 23_000, size: 200_000, percent: 12, model: 'claude-sonnet-5-5' },
    },
  ]
}

/** How the agents are drawn (the app's `flow.agents.avatar` setting): the page lets the visitor switch. */
let avatar: AvatarKind = 'gyro'
let redraw = () => {}

export function setAvatar(kind: AvatarKind) {
  avatar = kind
  redraw()
}

export function mountAgents(dock: HTMLIFrameElement, island: HTMLIFrameElement, data: DemoData, onNote: (text: string) => void) {
  clearSessions()
  cast(data, Date.now()).forEach(addSession)
  let dockReady = false
  const sendDock = () => dockReady && dock.contentWindow?.postMessage({ type: 'data', list: dockList(allSessions()), now: Date.now(), avatar }, location.origin)
  const drawIsland = () => {
    const render = (island.contentWindow as (Window & { insilodeRender?: (m: unknown) => void }) | null)?.insilodeRender
    render?.(islandModel(allSessions(), data.islandColors, avatar))
  }
  subscribeSessions(() => {
    sendDock()
    drawIsland()
  })
  island.addEventListener('load', drawIsland)
  redraw = () => {
    sendDock()
    drawIsland()
  }
  window.addEventListener('message', e => {
    if (e.origin !== location.origin) return
    const m = e.data as { source?: string; message?: { type: string; id?: string; width?: number; height?: number } }
    if (e.source === island.contentWindow && m?.source === 'insilode-island' && m.message?.type === 'size' && m.message.width && m.message.height) {
      island.style.width = `${m.message.width}px`
      island.style.height = `${m.message.height}px`
      return
    }
    if (e.source !== dock.contentWindow || m?.source !== 'insilode-dock' || !m.message) return
    if (m.message.type === 'ready') {
      dockReady = true
      sendDock()
    } else onNote('This is the Agents dock of the app, on a fixed moment of three agents. Use the button below it to answer the waiting one.')
  })
  setInterval(sendDock, 5000)
  // The pages may have loaded (and said `ready`) before the demo data arrived: then they are drawn now.
  if (dock.contentDocument?.readyState === 'complete') {
    dockReady = true
    sendDock()
  }
  drawIsland()
}

/** Answers the agent waiting for approval: it runs its tests and finishes. */
export function allowWaiting() {
  const waiting = allSessions().find(s => s.need?.kind === 'approval')
  if (!waiting) return false
  updateSession(waiting.id, { state: 'working', need: undefined, unread: false, since: Date.now(), activity: 'Running pytest billing-service/tests' })
  setTimeout(() => updateSession(waiting.id, { state: 'done', unread: true, since: Date.now(), activity: undefined, todos: waiting.todos.map(t => ({ ...t, status: 'completed' })) }), 3500)
  return true
}
