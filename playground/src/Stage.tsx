// The stage: the real flow canvas, the Agents dock beside it once an agent runs, the overlay floating at the top, and one line under it
// that says what is happening and what to do next.
import { useEffect, useRef } from 'react'
import { entryLabel, serviceOf, type ToCanvas } from './demo'
import { Dock, Island } from './pages'
import { useStore, entries, get, openEntry } from './store'
import { allow, deny, review, startOver, start } from './story'
import { useSessions } from './sessions'

const post = (frame: HTMLIFrameElement | null, message: unknown) => frame?.contentWindow?.postMessage(message, location.origin)

/** Polls until the canvas inside `frame` has drawn a card: only then does it listen for messages. */
function canvasReady(frame: HTMLIFrameElement, timeout = 60_000): Promise<boolean> {
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

function Canvas() {
  const target = useStore(s => s.target)
  const label = useStore(s => s.label)
  const edited = useStore(s => s.edited)
  const kept = useStore(s => s.kept)
  const frame = useRef<HTMLIFrameElement | null>(null)
  const first = useRef<string | undefined>(undefined)
  const ready = useRef<Promise<boolean>>(Promise.resolve(false))
  const key = `${target.kind}:${target.id}`

  // The canvas opens on the first target through its address; later ones go as `show`, the message the editor sends its webview.
  useEffect(() => {
    const f = frame.current
    if (!f) return
    if (first.current === undefined) {
      first.current = key
      ready.current = canvasReady(f)
      return
    }
    if (first.current === key) return
    first.current = key
    const message: ToCanvas = { type: 'show', target, label }
    void ready.current.then(() => post(f, message))
  }, [key, target, label])
  // Its code changed under it (the change went in, Keep, Undo): the canvas asks its host again.
  const seen = useRef(`${edited}${kept}`)
  useEffect(() => {
    const now = `${edited}${kept}`
    if (now === seen.current) return
    seen.current = now
    const f = frame.current
    void ready.current.then(() => post(f, { type: 'refresh' }))
  }, [edited, kept])

  const initial = get().target
  return <iframe ref={frame} className="canvas" title="Axle flow canvas" src={`./canvas.html?t=${encodeURIComponent(initial.kind === 'changes' ? 'changes' : initial.id)}`} />
}

/** The endpoints, to open one on the canvas. The middle of the bar is left free: the overlay hangs there. */
function Endpoints() {
  const edited = useStore(s => s.edited)
  const target = useStore(s => s.target)
  const list = entries(edited)
  // The order endpoint first (the story changes it), then by service.
  const shown = [...list].sort((a, b) => Number(b.http === 'POST /orders') - Number(a.http === 'POST /orders') || serviceOf(a).localeCompare(serviceOf(b), 'en') || a.http.localeCompare(b.http, 'en'))
  return (
    <div className="picks">
      <label>
        <span>Endpoint</span>
        <select value={target.kind === 'poly' ? target.id : ''} onChange={e => { const entry = list.find(x => x.id === e.target.value); if (entry) openEntry(entry) }}>
          {shown.map(e => (
            <option key={e.id} value={e.id}>
              {e.http}  ({serviceOf(e)})
            </option>
          ))}
        </select>
      </label>
      <span className="project">harbor-goods, a demo project</span>
    </div>
  )
}

function Caption() {
  const phase = useStore(s => s.phase)
  const caption = useStore(s => s.caption)
  const note = useStore(s => s.note)
  return (
    <div className="caption" role="status" aria-live="polite">
      <p>{caption}</p>
      {note && <p className="note">{note}</p>}
      <div className="actions">
        {phase === 'idle' && (
          <button type="button" className="primary" id="play" onClick={start}>
            Watch Claude change it
          </button>
        )}
        {phase === 'asking' && (
          <>
            <button type="button" className="primary" id="allow" onClick={allow}>
              Allow the edit
            </button>
            <button type="button" className="ghost" id="deny" onClick={deny}>
              Say no
            </button>
          </>
        )}
        {phase === 'done' && (
          <button type="button" className="primary" id="review" onClick={review}>
            See what it touched
          </button>
        )}
        {(phase === 'declined' || phase === 'done' || phase === 'review') && (
          <button type="button" className="ghost" id="again" onClick={startOver}>
            Start over
          </button>
        )}
      </div>
    </div>
  )
}

export function Stage() {
  const hasAgent = useSessions(list => list.length > 0)
  return (
    <div className="stage" id="stage">
      <Endpoints />
      <div className={`view${hasAgent ? ' with-dock' : ''}`}>
        <div className="canvaswrap">
          <Canvas />
        </div>
        <div className="dockwrap" aria-hidden={!hasAgent}>
          <Dock />
        </div>
      </div>
      <Island />
      <Caption />
    </div>
  )
}
