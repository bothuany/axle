// The editor host the canvas expects, played by a page: the canvas (ui/src/webview.tsx) talks to its host only through
// `acquireVsCodeApi().postMessage`, so this answers its requests from the demo data. Nothing is edited or saved here.
// Imported before the canvas: it sets the globals the canvas reads when it loads.
import type { FlowNode } from '../../protocol/flow'
import { entryLabel, type DemoData, type Impact, type Target, type ToShell } from './demo'

const READ_ONLY = 'This is a read-only demo. In the Axle app, edits on a card are applied to your files.'

interface Request {
  type: 'request'
  id: number
  op: string
  target?: Target
  turn?: number
}

const data: DemoData = await fetch('./data/demo.json').then(r => r.json())
const notifyShell = (m: ToShell) => window.parent !== window && window.parent.postMessage(m, location.origin)

/** The flow for a target. With a prompt picked in the timeline, the endpoints the agent's change reaches draw it on their cards. */
function graphOf(t: Target, turn?: number): FlowNode {
  if (t.kind === 'changes') return data.changes.root
  const flow = data.flows[t.id]
  if (!flow) throw new Error('This endpoint is not part of the demo.')
  return turn !== undefined && flow.changed ? flow.changed : flow.graph
}

function answer(m: Request): unknown {
  const target = m.target
  switch (m.op) {
    case 'graph': return graphOf(target!, m.turn)
    case 'callers': return target?.kind === 'poly' ? (data.flows[target.id]?.callers ?? null) : null
    case 'impact': return (target?.kind === 'changes' ? data.changes.impact : data.flows[target!.id]?.impact) satisfies Impact | undefined
    case 'timeline': return data.changes.timeline
    case 'editHooks': return []
    // The demo has no type graph: cards draw without chips, and nothing to open.
    case 'typeChips': return { chips: {}, ready: true, diagramAvailable: false }
    case 'typeDetail': return undefined
    case 'complete': return { items: [] }
    case 'signature':
    case 'hover': return null
    case 'definition': return { ok: false, message: 'Go to definition works in the Axle app, on your own code.' }
    case 'endEdit': return { ok: true }
    case 'save':
    case 'undo':
    case 'undoFrom': return { ok: false, message: READ_ONLY }
    case 'keep': throw new Error(READ_ONLY)
    default: throw new Error(`The demo does not answer "${m.op}".`)
  }
}

const host = {
  postMessage(m: { type: string; [key: string]: unknown }) {
    if (m.type === 'request') {
      const req = m as unknown as Request
      let result: { data?: unknown; error?: string }
      try {
        result = { data: answer(req) }
      } catch (e) {
        result = { error: (e as Error).message }
      }
      // Asynchronous, like a real host: the canvas must cope with an answer arriving after it asked.
      setTimeout(() => window.dispatchEvent(new MessageEvent('message', { data: { type: 'response', id: req.id, ...result } })), 0)
      return
    }
    // Everything else is the canvas asking the editor to do something the browser cannot: say so on the page.
    const what: Record<string, string> = {
      open: 'In the Axle app this opens the file in the editor, at that line.',
      reveal: 'In the Axle app this shows the line in the editor.',
      ask: 'In the Axle app this hands the flow to the agent you picked (Claude Code, Codex, any CLI).',
      mention: 'In the Axle app this @-mentions the card in your agent’s terminal.',
      answer: 'In the Axle app you accept or reject what an agent wants to edit here.',
    }
    if (what[m.type]) notifyShell({ source: 'axle-canvas', type: 'note', text: what[m.type] })
  },
}

;(window as unknown as { acquireVsCodeApi: () => typeof host }).acquireVsCodeApi = () => host

// Which flow opens first: `?t=<entry id>` or `?t=changes`, else the order flow.
const wanted = new URLSearchParams(location.search).get('t')
const entry = data.entries.find(e => e.id === wanted) ?? data.entries.find(e => e.http === 'POST /orders') ?? data.entries[0]
const first: { target: Target; label: string } = wanted === 'changes' ? { target: { kind: 'changes', id: '1' }, label: data.changes.label } : { target: { kind: 'poly', id: entry.id }, label: entryLabel(entry) }
;(window as unknown as { __FLOW__: unknown }).__FLOW__ = { ...first, dark: true }
notifyShell({ source: 'axle-canvas', type: 'ready' })
