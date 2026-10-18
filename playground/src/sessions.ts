// The agent sessions of the demo, and what the Agents dock and the desktop overlay are told about them. The ranking ("what needs you
// rises to the top"), the attention kinds and the overlay's model come from flow-agent's own vscode-free modules, so the two pages
// draw what the real ones would draw for the same sessions.
import { attentionKind, rank, type Need } from '../../editor/extensions/flow-agent/src/attention'
import { overlayModel, overlayOptions, readSettings, type OverlaySource } from '../../editor/extensions/flow-agent/src/desktopModel'
import type { AgentImpact, IslandColors } from './demo'

export interface Todo {
  text: string
  status: 'pending' | 'in_progress' | 'completed'
}

interface Tokens {
  input: number
  output: number
  cacheRead: number
  cacheWrite: number
}

/** A session as the dock reads it (flow-agent's AgentSession, the fields the page draws). */
export interface DemoSession extends OverlaySource {
  prompt?: string
  todos: Todo[]
  usage?: { used: number; size: number; percent: number; model: string }
  cost?: { session: { tokens: Tokens; usd: number }; prompt?: { tokens: Tokens; usd: number }; scope: string; usdSource: string }
  impact?: AgentImpact
}

type Listener = () => void
let sessions: DemoSession[] = []
const listeners = new Set<Listener>()

export const allSessions = () => sessions
export function subscribeSessions(l: Listener) {
  listeners.add(l)
  return () => {
    listeners.delete(l)
  }
}
export function updateSession(id: string, patch: Partial<DemoSession> | ((s: DemoSession) => Partial<DemoSession>)) {
  sessions = sessions.map(s => (s.id === id ? { ...s, ...(typeof patch === 'function' ? patch(s) : patch) } : s))
  listeners.forEach(l => l())
}
export function addSession(s: DemoSession) {
  sessions = [...sessions, s]
  listeners.forEach(l => l())
}
export const clearSessions = () => {
  sessions = []
  listeners.forEach(l => l())
}

export const needsYou = (list: DemoSession[] = sessions) => list.filter(s => attentionKind(s)).length

/** The rows the dock page draws: dock.ts's `post()`, for these sessions. */
export function dockList(list: DemoSession[]) {
  return rank(list).map(s => ({
    ...s,
    attention: attentionKind(s),
    done: s.todos.filter(t => t.status === 'completed').length,
    current: s.todos.find(t => t.status === 'in_progress')?.text,
    impact: s.impact && { files: s.impact.files, more: s.impact.more, flows: s.impact.flows.map(f => ({ label: f.label, via: f.via })), tables: s.impact.tables },
    worktree: undefined,
    clash: undefined,
  }))
}

/** What the overlay page is told: flow-agent's mapping, with the settings the app starts with. On this page the island floats on the stage; in the app it hangs from the notch. */
export function islandModel(list: DemoSession[], colors: IslandColors) {
  const settings = readSettings(key => (key === 'overlay.enabled' ? true : undefined))
  const model = overlayModel(list, settings)
  const options = overlayOptions(settings, 'gyro')
  return {
    items: model.items.map((item, i) => ({ ...item, key: `k${i}` })),
    counts: model.counts,
    style: options.style,
    size: options.size,
    opacity: options.opacity,
    colors,
    notch: 0,
    attached: false,
    avatar: options.avatar,
  }
}

export type { Need }
