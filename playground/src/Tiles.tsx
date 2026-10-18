// The three framed tiles of the page. Each is a small live piece of Axle with a caption in its corners saying what it is:
// the flow canvas on an endpoint, the agents tile (the Agents dock and the overlay following a scripted Claude), and the canvas
// again with the agent's change on its cards.
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { entryLabel, serviceOf, type Entry, type ToCanvas, type ToShell } from './demo'
import { Dock, Island } from './pages'
import { demo, onFlowRequest } from './store'
import { PROMPT, allow, deny, start, startOver, useStory, type Line } from './story'

const post = (frame: HTMLIFrameElement | null, message: unknown) => frame?.contentWindow?.postMessage(message, location.origin)

/** Polls until the canvas inside `frame` has drawn a card: only then does it listen for messages. It stops when the iframe is gone (Replay, unmount). */
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
      else if (!frame.isConnected || Date.now() - t0 > timeout) resolve(false)
      else setTimeout(tick, 100)
    }
    tick()
  })
}

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

/**
 * Starts the canvas's own “Review N changes” tour, which centres the first changed card at 100%, and zooms in twice with the canvas's own
 * “+” button (about the middle, where that card is): at 100% a card's code is small, and the change is what this tile is for.
 */
async function startReview(frame: HTMLIFrameElement, timeout = 6000) {
  const t0 = Date.now()
  const doc = () => {
    try {
      return frame.isConnected ? frame.contentDocument : null
    } catch {
      return null
    }
  }
  while (Date.now() - t0 < timeout) {
    const chip = doc()?.querySelector<HTMLButtonElement>('.chip.agent')
    if (chip) {
      chip.click()
      for (let i = 0; i < 2; i++) {
        await sleep(i ? 320 : 480)
        doc()?.querySelector<HTMLButtonElement>('.react-flow__controls-zoomin')?.click()
      }
      return
    }
    if (!doc()) return
    await sleep(120)
  }
}

/** True once the element has been near the screen: the canvas and the dock (several MB) load only for tiles a visitor scrolls to. */
function useNear(eager: boolean) {
  const ref = useRef<HTMLDivElement>(null)
  const [near, setNear] = useState(eager)
  useEffect(() => {
    const el = ref.current
    if (near || !el) return
    const io = new IntersectionObserver(entries => entries.some(e => e.isIntersecting) && setNear(true), { rootMargin: '600px 0px' })
    io.observe(el)
    return () => io.disconnect()
  }, [near])
  return [ref, near] as const
}

/** `skip` names the link that jumps over the iframes of the tile to its controls: a keyboard user would otherwise tab through every card. */
function Tile({ id, name, tag, live, state, skip, children, foot }: { id: string; name: string; tag: string; live?: boolean; state?: string; skip: string; children: ReactNode; foot?: ReactNode }) {
  return (
    <div className={state ? `tile ${state}` : 'tile'} id={id}>
      <header>
        <span>{name}</span>
        <span className={live ? 'tag live' : 'tag'}>{tag}</span>
      </header>
      <a className="skip" href={`#${id}-controls`}>
        {skip}
      </a>
      {children}
      {foot && (
        <div className="foot" id={`${id}-controls`} tabIndex={-1}>
          {foot}
        </div>
      )}
    </div>
  )
}

// ---- the flow canvas ------------------------------------------------------------------------------------------------

const SAYS: Record<'keep' | 'undo', string> = {
  keep: 'Kept. The marks are gone and the code stays changed.',
  undo: 'Undone. The code is back as it was, and so is the flow.',
}

/** The real canvas on one endpoint. `changed` starts with the agent's change in: its cards carry the green and red, and Keep and Undo work. */
export function FlowTile({ id, mode, entries, first, hint, eager }: { id: string; mode: 'before' | 'changed'; entries: Entry[]; first: string; hint: string; eager?: boolean }) {
  const [wrap, near] = useNear(!!eager)
  const [current, setCurrent] = useState(first)
  // The flow the canvas opens on when it loads: a request that comes before the tile has loaded is served by this.
  const [initial, setInitial] = useState(first)
  const [note, setNote] = useState<string | undefined>()
  const [decided, setDecided] = useState<'keep' | 'undo' | undefined>()
  const [round, setRound] = useState(0)
  const frame = useRef<HTMLIFrameElement | null>(null)
  const ready = useRef<Promise<boolean>>(Promise.resolve(false))
  const shown = useRef(first)
  const select = useRef<HTMLSelectElement>(null)

  // The canvas opens on the first flow through its address; later ones go as `show`, the message the editor sends its webview.
  const show = (entryId: string) => {
    const entry = entries.find(e => e.id === entryId)
    const f = frame.current
    if (!entry) return
    setCurrent(entryId)
    if (shown.current === entryId) return
    shown.current = entryId
    if (!f) return setInitial(entryId)
    const message: ToCanvas = { type: 'show', target: { kind: 'poly', id: entryId }, label: entryLabel(entry) }
    void ready.current.then(ok => {
      if (!ok) return
      post(f, message)
      if (mode === 'changed') void startReview(f)
    })
  }
  useEffect(() => {
    if (!near || !frame.current) return
    const f = frame.current
    ready.current = canvasReady(f)
    // The change is already in when this tile loads: step to its first card.
    if (mode === 'changed') void ready.current.then(ok => { if (ok) void startReview(f) })
  }, [near, round])
  // The dock's flow chips ask the change tile for a flow; the latest `show` answers (it reads this render's state).
  const latest = useRef(show)
  latest.current = show
  useEffect(() => (mode === 'changed' ? onFlowRequest(id => latest.current(id)) : undefined), [mode])

  // What the canvas says to the page around it: a note about what the app would do, or Keep and Undo.
  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      if (e.source !== frame.current?.contentWindow || e.origin !== location.origin) return
      const m = e.data as ToShell
      if (m?.source !== 'axle-canvas') return
      if (m.type === 'open' || m.type === 'reveal') setNote('In the Axle app this opens the file in the editor, at that line.')
      else if (m.type === 'note') setNote(m.text)
      else if (m.type === 'decided' && (m.what === 'keep' || m.what === 'undo')) setDecided(m.what)
    }
    window.addEventListener('message', onMessage)
    return () => window.removeEventListener('message', onMessage)
  }, [])
  useEffect(() => {
    if (!note) return
    const t = setTimeout(() => setNote(undefined), 7000)
    return () => clearTimeout(t)
  }, [note])

  const replay = () => {
    shown.current = first
    setCurrent(first)
    setInitial(first)
    setDecided(undefined)
    setNote(undefined)
    setRound(r => r + 1)
    // The button that was clicked is gone: keyboard focus goes to the select, the first control of the tile.
    requestAnimationFrame(() => select.current?.focus({ preventScroll: true }))
  }
  const entry = entries.find(e => e.id === current)
  return (
    <Tile
      id={id}
      name={`flow · ${entry ? entry.http : ''}`}
      tag="live canvas"
      live
      skip="Skip the canvas"
      foot={
        <>
          <p role="status">{note ?? (decided ? SAYS[decided] : hint)}</p>
          {mode === 'changed' && decided && (
            <button type="button" className="ghost replay" onClick={replay}>
              Replay the change
            </button>
          )}
        </>
      }
    >
      <div className="bar">
        <label>
          <span>Endpoint</span>
          <select ref={select} aria-label="Endpoint" value={current} onChange={e => show(e.target.value)}>
            {entries.map(e => (
              <option key={e.id} value={e.id}>
                {e.http}  ({serviceOf(e)})
              </option>
            ))}
          </select>
        </label>
        <span className="project">harbor-goods, a demo project</span>
      </div>
      <div className={mode === 'changed' ? 'canvasbox tall' : 'canvasbox'} ref={wrap}>
        {near && <iframe key={round} ref={frame} className="canvas" title={`Axle flow canvas, ${id}`} src={`./canvas.html?t=${encodeURIComponent(initial)}${mode === 'changed' ? '&mode=changed' : ''}`} />}
      </div>
    </Tile>
  )
}

// ---- the agents ----------------------------------------------------------------------------------------------------

const STATE_WORDS: Record<Line['state'], string> = { doing: 'in progress', done: 'done', waiting: 'waiting for you', no: 'refused' }

/** The steps Claude takes. The list is always on the page, so a screen reader hears the first step too; each one says its state in words. */
function Steps({ lines }: { lines: Line[] }) {
  return (
    <ol className="steps" aria-label="What Claude does" aria-live="polite">
      {lines.map((l, i) => (
        <li key={i} className={l.state}>
          <span className="mark" aria-hidden="true" />
          <span>{l.text}</span>
          <span className="sr">, {STATE_WORDS[l.state]}</span>
        </li>
      ))}
    </ol>
  )
}

/** The Agents dock and the overlay, following a scripted Claude on the demo project. */
export function AgentsTile() {
  const [wrap, near] = useNear(false)
  const phase = useStory(s => s.phase)
  const lines = useStory(s => s.lines)
  const [note, setNote] = useState<string | undefined>()
  useEffect(() => {
    if (!note) return
    const t = setTimeout(() => setNote(undefined), 7000)
    return () => clearTimeout(t)
  }, [note])
  // A note is about now: the next step of the story replaces it.
  useEffect(() => setNote(undefined), [phase])
  // The button a keyboard user pressed is gone when the story moves on; focus goes to the next one, once there is one.
  const refocus = useRef(false)
  useEffect(() => {
    if (!refocus.current) return
    const next = document.querySelector<HTMLButtonElement>('#agents-tile .foot button')
    if (next) {
      next.focus({ preventScroll: true })
      refocus.current = false
    }
  }, [phase])
  const act = (f: () => void) => () => {
    refocus.current = true
    f()
  }
  const foot =
    phase === 'idle' ? (
      <>
        <p role="status">{note ?? 'Claude Code, on the demo project, with a task. It is a scripted replay: the dock and the overlay are the app’s own.'}</p>
        <button type="button" className="primary" id="play" onClick={act(start)}>
          Start the agent
        </button>
      </>
    ) : phase === 'asking' ? (
      <>
        <p role="status">{note ?? 'Claude is blocked until you answer. The overlay at the top and the dock say the same.'}</p>
        <div className="actions">
          <button type="button" className="primary" id="allow" onClick={act(allow)}>
            Allow the edit
          </button>
          <button type="button" className="ghost" id="deny" onClick={act(deny)}>
            Say no
          </button>
        </div>
      </>
    ) : phase === 'working' ? (
      <p role="status">{note ?? 'Claude works. The dock row and the overlay change with it.'}</p>
    ) : (
      <>
        <p role="status">{note ?? (phase === 'done' ? 'The turn is over, and the dock lists what it touched. Click a flow to see it.' : 'Nothing was changed. Claude waits for what you would rather it do.')}</p>
        <div className="actions">
          {phase === 'done' && (
            <button type="button" className="primary" id="review" onClick={() => document.getElementById('changes-tile')?.scrollIntoView({ behavior: 'smooth', block: 'center' })}>
              See the change
            </button>
          )}
          <button type="button" className="ghost" id="again" onClick={act(startOver)}>
            Start over
          </button>
        </div>
      </>
    )
  return (
    <Tile id="agents-tile" name={`claude code · ${PROMPT}`} tag="scripted replay" skip="Skip the dock" state={phase === 'asking' ? 'asking' : undefined} foot={foot}>
      <div className="agentsbody" ref={wrap}>
        <div className="log">
          <Steps lines={lines} />
          {!lines.length && <p className="empty">Press “Start the agent”. Each step Claude takes shows up here, and in the dock.</p>}
        </div>
        <div className="dockwrap">{near && <Dock onNote={setNote} />}</div>
        {near && <Island />}
      </div>
    </Tile>
  )
}

/** The endpoints the demo has, in the order the select lists them: the order endpoint first (the story changes it), then by service. */
export const orderedEntries = (entries: Entry[]) => [...entries].sort((a, b) => Number(b.http === 'POST /orders') - Number(a.http === 'POST /orders') || serviceOf(a).localeCompare(serviceOf(b), 'en') || a.http.localeCompare(b.http, 'en'))

/** The endpoints the agent's change reached, from the turn impact. */
export const touchedEntries = () => {
  const ids = new Set(demo().agentImpact.flows.map(f => f.id))
  return orderedEntries(demo().after.entries.filter(e => ids.has(e.id)))
}
