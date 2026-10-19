// The demo data every part of the page reads, and the one message that crosses between the tiles: the dock asks for a flow, and the
// canvas tile further down opens it.
import type { DemoData } from './demo'

let data: DemoData | undefined
export const setData = (d: DemoData) => {
  data = d
}
export const demo = (): DemoData => {
  if (!data) throw new Error('The demo data is not loaded yet.')
  return data
}

type FlowRequest = (entryId: string) => void
const requests = new Set<FlowRequest>()
/** The canvas tile listens; the dock's “this turn touched” chips ask. */
export function onFlowRequest(listener: FlowRequest) {
  requests.add(listener)
  return () => {
    requests.delete(listener)
  }
}
export const requestFlow = (entryId: string) => requests.forEach(r => r(entryId))

/** Scrolls a tile into the middle of the screen, so the whole of it is seen at once. */
export function bringIntoView(id: string) {
  document.getElementById(id)?.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'center' })
}
