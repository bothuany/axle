// What the page knows: which flow the stage shows, where the agent's story is, and whether its change is in the code. One small store the
// components subscribe to; the story (story.ts) changes it the way a real session changes the real editor.
import { useSyncExternalStore } from 'react'
import { entryLabel, type DemoData, type Entry, type Target } from './demo'

/** Where the visitor is in the story: nothing started, the agent working, waiting for a yes, done, reviewing its change, or told no. */
export type Phase = 'idle' | 'working' | 'asking' | 'done' | 'review' | 'declined'

export interface State {
  phase: Phase
  /** The line under the stage: what is happening and what to do next. */
  caption: string
  /** The agent's change is in the code (the canvas draws the changed code). */
  edited: boolean
  /** Keep was pressed: the canvas stops marking the change; the code stays changed. */
  kept: boolean
  target: Target
  label: string
  /** What the demo cannot do, said when a visitor reaches for it (cleared after a few seconds). */
  note?: string
}

let data: DemoData | undefined
export const setData = (d: DemoData) => {
  data = d
}
export const demo = (): DemoData => {
  if (!data) throw new Error('The demo data is not loaded yet.')
  return data
}

export const IDLE_CAPTION = 'This is the flow of POST /orders: who calls it on the left, what it runs on the right, down to the table it writes. Open another endpoint above, or watch an agent change it.'

let state: State | undefined
const listeners = new Set<() => void>()
export function get(): State {
  if (!state) {
    const first = startEntry()
    state = { phase: 'idle', caption: IDLE_CAPTION, edited: false, kept: false, target: { kind: 'poly', id: first.id }, label: entryLabel(first) }
  }
  return state
}
export function set(patch: Partial<State>) {
  state = { ...get(), ...patch }
  listeners.forEach(l => l())
}
export function useStore<T>(select: (s: State) => T): T {
  return useSyncExternalStore(
    cb => {
      listeners.add(cb)
      return () => listeners.delete(cb)
    },
    () => select(get()),
  )
}

/** The endpoint the page opens on: the order controller, the one the story changes. */
export const startEntry = (): Entry => demo().before.entries.find(e => e.http === 'POST /orders') ?? demo().before.entries[0]

/** The endpoints of the project as it is now. */
export const entries = (edited = get().edited): Entry[] => (edited ? demo().after : demo().before).entries

export function openEntry(e: Entry) {
  set({ target: { kind: 'poly', id: e.id }, label: entryLabel(e) })
}

let noteTimer: ReturnType<typeof setTimeout> | undefined
export function note(text: string) {
  clearTimeout(noteTimer)
  set({ note: text })
  noteTimer = setTimeout(() => set({ note: undefined }), 7000)
}
