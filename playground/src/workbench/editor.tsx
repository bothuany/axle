// The editor groups: code on the left (Monaco in an iframe per tab) and the flow canvas beside it (the real canvas in an iframe).
// The iframes stay mounted while they are open, so a tab keeps its scroll position and the canvas its zoom, as in the real editor.
import { useEffect, useRef } from 'react'
import { FileIcon, Ci, Tb } from './parts'
import { closeCode, closeFlow, set, useWorkbench } from './store'
import type { ToCanvas } from '../demo'

const post = (frame: HTMLIFrameElement | null, message: unknown) => frame?.contentWindow?.postMessage(message, location.origin)

/** Polls until the canvas inside `frame` has drawn a card: only then does it listen for messages. */
export function canvasReady(frame: HTMLIFrameElement, timeout = 60_000): Promise<boolean> {
  const t0 = Date.now()
  return new Promise(resolve => {
    const tick = () => {
      let ok = false
      try {
        ok = !!frame.contentDocument?.querySelector('.react-flow__node')
      } catch {
        ok = false
      }
      if (ok) resolve(true)
      else if (Date.now() - t0 > timeout) resolve(false)
      else setTimeout(tick, 100)
    }
    tick()
  })
}

export function CodeGroup() {
  const tabs = useWorkbench(s => s.codeTabs)
  const active = useWorkbench(s => s.activeCode)
  const edited = useWorkbench(s => s.edited)
  const frames = useRef(new Map<string, HTMLIFrameElement>())
  // The files changed under the open tabs (the agent's edit, Undo): each editor draws its file again.
  useEffect(() => {
    frames.current.forEach(f => post(f, { type: 'files' }))
  }, [edited])
  // A line asked for (the canvas opened a card's file at its line).
  useEffect(() => {
    for (const t of tabs) if (t.line) post(frames.current.get(t.id) ?? null, { type: 'reveal', line: t.line })
  }, [tabs])
  return (
    <div className="group" aria-label="Code editor group">
      <div className="tabs" role="tablist">
        {tabs.map(t => {
          const name = t.path.split('/').at(-1)!
          return (
            <div key={t.id} className={`tab${t.id === active ? ' on' : ''}`} role="tab" aria-selected={t.id === active} onClick={() => set({ activeCode: t.id })} title={t.path}>
              <FileIcon name={name} />
              <span>{t.diff ? `${name} (Working Tree)` : name}</span>
              <button type="button" className="x" aria-label={`Close ${name}`} onClick={e => { e.stopPropagation(); closeCode(t.id) }}>
                <Ci name="close" className="s" />
              </button>
            </div>
          )
        })}
        <span className="grow" />
      </div>
      <div className="pane">
        {tabs.length === 0 && (
          <div className="empty">
            <img className="watermark" src="./icon.svg" alt="" />
          </div>
        )}
        {tabs.map(t => (
          <iframe
            key={t.id}
            ref={el => {
              if (el) frames.current.set(t.id, el)
              else frames.current.delete(t.id)
            }}
            title={t.path}
            src={`./editor.html?path=${encodeURIComponent(t.path)}${t.diff ? '&diff=1' : ''}${t.line ? `&line=${t.line}` : ''}`}
            style={{ display: t.id === active ? 'block' : 'none' }}
          />
        ))}
      </div>
    </div>
  )
}

export function FlowGroup() {
  const tab = useWorkbench(s => s.flowTabs[0])
  const edited = useWorkbench(s => s.edited)
  const kept = useWorkbench(s => s.kept)
  const frame = useRef<HTMLIFrameElement | null>(null)
  const first = useRef<string | undefined>(undefined)
  const ready = useRef<Promise<boolean>>(Promise.resolve(false))
  const target = tab && `${tab.target.kind}:${tab.target.id}`

  // The canvas opens on the first target through its address; later ones go as `show`, the message the editor sends its webview.
  useEffect(() => {
    if (!tab || !frame.current) return
    if (first.current === undefined) {
      first.current = target
      ready.current = canvasReady(frame.current)
      return
    }
    if (first.current === target) return
    const message: ToCanvas = { type: 'show', target: tab.target, label: tab.label }
    const f = frame.current
    void ready.current.then(() => post(f, message))
    first.current = target
  }, [target, tab])
  useEffect(() => {
    if (!tab) first.current = undefined
  }, [tab])
  // Its code changed under it (the change went in, Keep, Undo): the canvas asks its host again.
  const seen = useRef(`${edited}${kept}`)
  useEffect(() => {
    const now = `${edited}${kept}`
    if (now === seen.current) return
    seen.current = now
    const f = frame.current
    void ready.current.then(() => post(f, { type: 'refresh' }))
  }, [edited, kept])

  if (!tab) return null
  const initial = tab.target.kind === 'changes' ? 'changes' : tab.target.id
  return (
    <div className="group" aria-label="Flow canvas group">
      <div className="tabs" role="tablist">
        <div className="tab on" role="tab" aria-selected="true">
          <Ci name="type-hierarchy-sub" className="s" />
          <span>Flow: {tab.label}</span>
          <button type="button" className="x" aria-label="Close flow" onClick={() => closeFlow()}>
            <Ci name="close" className="s" />
          </button>
        </div>
        <span className="grow" />
        <Tb icon="ellipsis" title="More Actions…" />
      </div>
      <div className="pane">
        <iframe ref={frame} title="Axle flow canvas" src={`./canvas.html?t=${encodeURIComponent(initial)}`} />
      </div>
    </div>
  )
}

