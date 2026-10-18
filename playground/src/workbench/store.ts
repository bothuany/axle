// The workbench's state: what is open where, which view is showing, whether the agent's change is in the files. One small store
// the components subscribe to; the simulated agent (sim/) changes it the way a real session changes the real editor.
import { useSyncExternalStore } from 'react'
import { entryLabel, type DemoData, type Entry, type Target } from '../demo'

export type ViewId = 'explorer' | 'search' | 'scm' | 'debug' | 'extensions' | 'harness' | 'axle'
export type PanelTab = 'problems' | 'output' | 'debug' | 'terminal'

export interface CodeTab {
  id: string
  /** Path in the demo project. */
  path: string
  /** The diff of a changed file, not the file. */
  diff?: boolean
  /** The line to show when the tab opens or is asked to. */
  line?: number
}

export interface FlowTab {
  id: string
  target: Target
  label: string
}

export interface TerminalInfo {
  id: string
  kind: 'shell' | 'claude'
  title: string
}

export interface State {
  view: ViewId
  sidebar: boolean
  codeTabs: CodeTab[]
  activeCode: string | undefined
  flowTabs: FlowTab[]
  activeFlow: string | undefined
  panel: boolean
  panelTab: PanelTab
  terminals: TerminalInfo[]
  activeTerminal: string
  /** The agent's change is in the files. */
  edited: boolean
  /** Keep was pressed: the canvas no longer marks the change (the files stay changed, as in git). */
  kept: boolean
  /** The notification on the bottom right: what an agent needs, or a note about the demo. */
  toast: { id: number; text: string; actions?: string[] } | undefined
}

let state: State = {
  view: 'explorer',
  sidebar: true,
  codeTabs: [],
  activeCode: undefined,
  flowTabs: [],
  activeFlow: undefined,
  panel: true,
  panelTab: 'terminal',
  terminals: [{ id: 'shell-1', kind: 'shell', title: 'zsh' }],
  activeTerminal: 'shell-1',
  edited: false,
  kept: false,
  toast: undefined,
}

const listeners = new Set<() => void>()
const emit = () => listeners.forEach(l => l())
export const get = () => state
export function set(patch: Partial<State> | ((s: State) => Partial<State>)) {
  state = { ...state, ...(typeof patch === 'function' ? patch(state) : patch) }
  emit()
}
export function useWorkbench<T>(select: (s: State) => T): T {
  return useSyncExternalStore(
    cb => {
      listeners.add(cb)
      return () => listeners.delete(cb)
    },
    () => select(state),
  )
}

// ---- actions --------------------------------------------------------------------------------------------------------

let data: DemoData | undefined
export const setData = (d: DemoData) => {
  data = d
}
export const demo = (): DemoData => {
  if (!data) throw new Error('The demo data is not loaded yet.')
  return data
}
/** The endpoints of the project as it is now. */
export const entries = (s: State = state): Entry[] => (s.edited ? demo().after : demo().before).entries

let ids = 0
export function openFile(path: string, opts: { diff?: boolean; line?: number } = {}) {
  set(s => {
    const id = `${path}${opts.diff ? ':diff' : ''}`
    const existing = s.codeTabs.find(t => t.id === id)
    const tab: CodeTab = { id, path, diff: opts.diff, line: opts.line }
    return { codeTabs: existing ? s.codeTabs.map(t => (t.id === id ? { ...t, line: opts.line ?? t.line } : t)) : [...s.codeTabs, tab], activeCode: id }
  })
}
export function closeCode(id: string) {
  set(s => {
    const codeTabs = s.codeTabs.filter(t => t.id !== id)
    return { codeTabs, activeCode: s.activeCode === id ? codeTabs.at(-1)?.id : s.activeCode }
  })
}

/** Opens a flow in the group on the right (the editor opens flows beside the code), or shows it in the tab that is there. */
export function openFlow(target: Target, label: string) {
  set(s => {
    const id = target.kind === 'changes' ? 'changes' : `flow-${ids++}`
    // One flow tab, reused: asking for another flow shows it in the same tab, as the Axle canvas does.
    const existing = s.flowTabs[0]
    if (existing) return { flowTabs: [{ ...existing, target, label }], activeFlow: existing.id }
    return { flowTabs: [{ id, target, label }], activeFlow: id }
  })
}
export const openEntry = (e: Entry) => openFlow({ kind: 'poly', id: e.id }, entryLabel(e))
export function closeFlow() {
  set({ flowTabs: [], activeFlow: undefined })
}

export function toast(text: string, actions?: string[]) {
  set({ toast: { id: ++ids, text, actions } })
}
export const dismissToast = () => set({ toast: undefined })

// ---- the files the project has right now ----------------------------------------------------------------------------

/** The text of a file now: the agent's version once its change is in. */
export function textOf(path: string, edited = state.edited): string | undefined {
  const f = demo().files.find(f => f.path === path)
  return f && (edited && f.after !== undefined ? f.after : f.text)
}
/** The files the agent's change touched, while it is in. */
export const changedFiles = (edited = state.edited) => (edited ? demo().files.filter(f => f.after !== undefined) : [])
