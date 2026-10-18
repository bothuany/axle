// The two pages the real app draws outside the editor's own views, in iframes here: the Agents dock (flow-agent's dock page, in the
// right-hand side panel) and the desktop status overlay that hangs from the top of the screen. Both are the real pages; they are
// told what the real mapping code makes of the demo's sessions, and what they ask for is answered here.
import { useEffect, useRef, useState } from 'react'
import { attentionKind } from '../../../editor/extensions/flow-agent/src/attention'
import { allSessions, dockList, islandModel, subscribeSessions, updateSession } from '../sim/sessions'
import { focusSession, openTurnFlow, startClaude } from '../sim/scenario'
import { demo, toast } from './store'

const NOTES: Record<string, string> = {
  pick: 'In the Axle app “Other…” starts Gemini, Aider or any command you add, in a terminal.',
  chat: 'In the Axle app this turns the chat panel back on.',
  xray: 'In the Axle app the bar under a row opens the context X-ray: what fills this agent’s window.',
  compact: 'In the Axle app this sends /compact to the agent’s terminal.',
  rename: 'In the Axle app this renames the agent (and its /resume name).',
  forget: 'In the Axle app this removes a closed agent from the list.',
  pr: 'In the Axle app this opens the pull request of the agent’s branch.',
  wt: 'In the Axle app a worktree row can be opened, diffed, merged or removed.',
}

/** The Agents dock: one row per agent terminal, ranked by what needs you. */
export function Dock() {
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
      const m = (e.data as { source?: string; message?: { type: string; id?: string; index?: number; cli?: string } })
      if (m?.source !== 'axle-dock' || !m.message) return
      const msg = m.message
      if (msg.type === 'ready') {
        loaded.current = true
        send()
      } else if (msg.type === 'new') {
        if (msg.cli === 'claude') startClaude()
        else toast('Codex starts the same way in the Axle app. This demo only has Claude Code.')
      } else if (msg.type === 'show' && msg.id) focusSession(msg.id)
      else if (msg.type === 'flow' && msg.id !== undefined && typeof msg.index === 'number') openTurnFlow(msg.id, msg.index)
      else if (NOTES[msg.type]) toast(NOTES[msg.type])
    }
    window.addEventListener('message', onMessage)
    // The page's own clock ("Working · 12s") ticks every few seconds; the rows are redrawn as often.
    const tick = setInterval(send, 5000)
    return () => {
      off()
      window.removeEventListener('message', onMessage)
      clearInterval(tick)
    }
  }, [])
  return <iframe ref={frame} className="dock" title="Agents" src="./pages/dock.html" onLoad={() => void 0} />
}

/** The overlay: a black island hanging from the notch, one avatar per agent; hovering opens the list. */
export function Island() {
  const frame = useRef<HTMLIFrameElement>(null)
  const [size, setSize] = useState<{ width: number; height: number } | undefined>()
  const [shown, setShown] = useState(false)
  const keys = useRef<string[]>([])
  const draw = () => {
    const f = frame.current
    const render = (f?.contentWindow as (Window & { axleRender?: (m: unknown) => void }) | null | undefined)?.axleRender
    if (!render) return
    const list = allSessions().filter(s => s.state !== 'ended')
    const model = islandModel(list, demo().islandColors)
    keys.current = model.items.map(i => i.id)
    // autoHide.noAgents: no agent, no overlay.
    setShown(model.items.length > 0)
    render(model)
  }
  useEffect(() => {
    const off = subscribeSessions(draw)
    const onMessage = (e: MessageEvent) => {
      if (e.source !== frame.current?.contentWindow || e.origin !== location.origin) return
      const m = e.data as { source?: string; message?: { type: string; width?: number; height?: number; key?: string } }
      if (m?.source !== 'axle-island' || !m.message) return
      if (m.message.type === 'size' && m.message.width && m.message.height) setSize({ width: m.message.width, height: m.message.height })
      if (m.message.type === 'click' && m.message.key) {
        const id = keys.current[Number(m.message.key.slice(1))]
        if (id) focusSession(id)
      }
    }
    window.addEventListener('message', onMessage)
    // Minutes and seconds in the overlay: it asks for its own once a second; sessions change what it shows.
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
      style={{ width: size?.width ?? 300, height: size?.height ?? 60, visibility: shown && size ? 'visible' : 'hidden', pointerEvents: shown ? 'auto' : 'none' }}
      tabIndex={-1}
    />
  )
}

/** A session that nobody has looked at since it needed you, for the status of the whole demo (the guide reads it). */
export const needsAttention = () => allSessions().some(s => attentionKind(s))
export const markRead = (id: string) => updateSession(id, { unread: false })
