// The two pages the real app draws for its agents, in iframes here: the Agents dock (flow-agent's dock page) and the status overlay (the
// island the desktop app hangs from the top of the screen). Both are the real pages; they are told what the real ranking and mapping code
// makes of the demo's sessions, and what they ask for is answered here.
import { useEffect, useRef, useState } from 'react'
import { allSessions, dockList, islandModel, subscribeSessions } from './sessions'
import { bringIntoView, demo, requestFlow } from './store'
import { touchedFlowId } from './story'

/** The Agents dock: one row per agent, ranked by what needs you. */
export function Dock({ onNote }: { onNote: (text: string) => void }) {
  const frame = useRef<HTMLIFrameElement>(null)
  const loaded = useRef(false)
  const send = () => {
    if (!loaded.current) return
    frame.current?.contentWindow?.postMessage({ type: 'data', list: dockList(allSessions()), now: Date.now(), avatar: 'gyro' }, location.origin)
  }
  useEffect(() => {
    const off = subscribeSessions(send)
    const onMessage = (e: MessageEvent) => {
      if (e.source !== frame.current?.contentWindow || e.origin !== location.origin) return
      const m = e.data as { source?: string; message?: { type: string; index?: number } }
      if (m?.source !== 'axle-dock' || !m.message) return
      if (m.message.type === 'ready') {
        loaded.current = true
        send()
      } else if (m.message.type === 'flow' && typeof m.message.index === 'number') {
        // A flow chip: the canvas tile below opens that flow with the change on its cards.
        const id = touchedFlowId(m.message.index)
        if (id) {
          requestFlow(id)
          bringIntoView('changes-tile')
        }
      } else onNote('This is the Agents dock of the app. In the demo only the flows it lists open.')
    }
    window.addEventListener('message', onMessage)
    // The page's own clock (“Working · 12s”) ticks every few seconds; the rows are redrawn as often.
    const tick = setInterval(send, 5000)
    return () => {
      off()
      window.removeEventListener('message', onMessage)
      clearInterval(tick)
    }
  }, [])
  return <iframe ref={frame} className="dock" title="Agents dock" src="./pages/dock.html" />
}

/** The overlay: a black island, one avatar per agent; hovering opens the list. */
export function Island() {
  const frame = useRef<HTMLIFrameElement>(null)
  const [size, setSize] = useState<{ width: number; height: number } | undefined>()
  const [shown, setShown] = useState(false)
  const draw = () => {
    const render = (frame.current?.contentWindow as (Window & { axleRender?: (m: unknown) => void }) | null | undefined)?.axleRender
    if (!render) return
    const model = islandModel(allSessions().filter(s => s.state !== 'ended'), demo().islandColors)
    // autoHide.noAgents: no agent, no overlay.
    setShown(model.items.length > 0)
    render(model)
  }
  useEffect(() => {
    const off = subscribeSessions(draw)
    const onMessage = (e: MessageEvent) => {
      if (e.source !== frame.current?.contentWindow || e.origin !== location.origin) return
      const m = e.data as { source?: string; message?: { type: string; width?: number; height?: number } }
      if (m?.source === 'axle-island' && m.message?.type === 'size' && m.message.width && m.message.height) setSize({ width: m.message.width, height: m.message.height })
    }
    window.addEventListener('message', onMessage)
    return () => {
      off()
      window.removeEventListener('message', onMessage)
    }
  }, [])
  return (
    <iframe
      ref={frame}
      className="island"
      title="Axle agents overlay"
      src="./pages/island.html"
      onLoad={draw}
      style={{ width: size?.width ?? 300, height: size?.height ?? 60, opacity: shown && size ? 1 : 0, pointerEvents: shown ? 'auto' : 'none' }}
      tabIndex={-1}
    />
  )
}
