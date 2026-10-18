// What scripts/playground-data.mjs writes (public/data/demo.json) and what the shell and the fake host read.
// The cards and entry points are the protocol types: the same ones flow-view sends the canvas.
import type { EntryPoint, FlowNode } from '../../protocol/flow'

export interface Entry extends EntryPoint {
  source: 'poly'
}

/** What the canvas shows under "Affects N endpoints". */
export interface Impact {
  label: string
  items: string[]
}

/** One prompt to an agent that changed code (the canvas' timeline). */
export interface TurnSummary {
  id: number
  prompt: string
  agent: string
  at: number
  files: { file: string; plus: number; minus: number }[]
}

export interface FlowData {
  graph: FlowNode
  callers: FlowNode | null
  impact: Impact
  /** The same flow with the agent's change on its cards, when the change reaches it. */
  changed?: FlowNode
}

export interface DemoData {
  entries: Entry[]
  flows: Record<string, FlowData>
  changes: { label: string; root: FlowNode; impact: Impact; timeline: TurnSummary[] }
}

/** What the canvas is asked to show: an endpoint's flow, or the agent's change set. */
export type Target = { kind: 'poly'; id: string } | { kind: 'changes'; id: string }

/** How the canvas names an entry in its bar ("OrderController.place"). */
export const entryLabel = (e: EntryPoint) => `${e.controller}.${e.action}`

/** The service an entry lives in: the first folder under the demo project's root. */
export const serviceOf = (e: EntryPoint) => e.file.split('/')[2] ?? 'demo'

/** Messages the canvas page sends its parent (the shell), and the other way round (`show`, `cursor`). */
export type ToShell = { source: 'axle-canvas'; type: 'note'; text: string } | { source: 'axle-canvas'; type: 'ready' }
export type ToCanvas = { type: 'show'; target: Target; label: string } | { type: 'cursor'; file: string; line: number }
