// The agent's gaze, drawn: a dot in each agent's colour on the card it reads, a fading bar on the cards it visited, and a list of
// what it reads off this flow. It only paints. It never pans, opens or selects anything: the user's view stays the user's.
import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { ViewportPortal, useReactFlow, type Node } from '@xyflow/react'
import { CODE_PAD, HEADER_H, LINE_H, type CardData } from '../layout'
import type { CanvasToHostTour, FlowNode, GazeEvent } from '../types'
import { Arrow } from '../tour/Arrow'
import { lineY } from '../tour/geometry'
import { baseName, BURST, keep, paint, sanitizeGaze, TRAIL_MS, type Marker } from './trail'
import './gaze.css'

export interface GazeEnv {
  down: FlowNode | null
  up: FlowNode | null
  showUp: boolean
  /** Laid-out cards: the marks follow them when the flow is drawn again. */
  nodes: Node[]
  /** A tour is playing (a replay among them): the live marks step aside. */
  quiet: boolean
  post(msg: CanvasToHostTour | { type: 'open'; file: string; line: number }): void
}

/** How often the trail fades a step, while there is one. */
const TICK_MS = 2000

export function useGaze(env: GazeEnv) {
  const rf = useReactFlow()
  const [events, setEvents] = useState<GazeEvent[]>([])
  const [on, setOn] = useState(true)
  const [open, setOpen] = useState(false)
  const [now, setNow] = useState(() => Date.now())
  /** The last message was a burst: the dots jump to where they end instead of gliding. */
  const [burst, setBurst] = useState(false)

  useEffect(() => {
    const onMsg = (e: MessageEvent) => {
      const m = e.data
      if (m?.type === 'gaze') {
        const more = sanitizeGaze(m.events)
        if (!more.length) return
        setBurst(m.burst === true || more.length > BURST)
        setEvents(list => keep(list, more))
        setNow(Date.now())
      } else if (m?.type === 'gazeClear') {
        setEvents(list => (typeof m.session === 'string' ? list.filter(x => x.session !== m.session) : []))
      }
    }
    window.addEventListener('message', onMsg)
    return () => window.removeEventListener('message', onMsg)
  }, [])

  // The trail fades while it is young; once every visit is older than the fade, nothing changes and the clock stops.
  const newest = events.at(-1)?.at ?? 0
  useEffect(() => {
    if (!on || !newest) return
    const id = setInterval(() => {
      const t = Date.now()
      setNow(t)
      if (t - newest > TRAIL_MS + TICK_MS) clearInterval(id)
    }, TICK_MS)
    return () => clearInterval(id)
  }, [newest, on])

  const trees = useMemo(() => [env.down, env.showUp ? env.up : null], [env.down, env.up, env.showUp])
  const painted = useMemo(() => paint(events, trees, now), [events, trees, now])
  const shown = on && !env.quiet

  const flowLayer = shown && (painted.trail.length > 0 || painted.markers.length > 0) && (
    <ViewportPortal>
      {painted.trail.map(t => {
        const card = rf.getNode(t.key)
        if (!card) return null
        const h = Number(card.style?.height) || 120
        return (
          <div
            key={`t-${t.key}`}
            className={`gaze-bar${t.edited ? ' edited' : ''}`}
            style={{ transform: `translate(${card.position.x - 7}px, ${card.position.y}px)`, height: h, opacity: t.strength, '--gz': t.color } as CSSProperties}
            aria-hidden="true"
          >
            {t.reads > 1 && <span className="gaze-count">×{Math.min(t.reads, 99)}</span>}
          </div>
        )
      })}
      {painted.markers.map((m, i) => (
        <Dot key={`m-${m.session}`} marker={m} index={i} instant={burst} />
      ))}
    </ViewportPortal>
  )

  const replay = (session: string) => env.post({ type: 'gazeReplay', session })
  const away = painted.elsewhere
  const overlay = shown && painted.agents.length > 0 && (
    <div className="gaze-box" role="region" aria-label="Where agents are looking">
      {painted.agents.map(a => (
        <div className="gaze-agent" key={a.session} style={{ '--gz': a.color } as CSSProperties}>
          <span className="gaze-dot-mini" />
          <span className="gaze-name">{a.label}</span>
          <button className="btn ghost gaze-replay" onClick={() => replay(a.session)} title="Play this agent's path since its last prompt as a tour">
            Replay trail
          </button>
        </div>
      ))}
      {away.length > 0 && (
        <>
          <button className="gaze-away-toggle" aria-expanded={open} onClick={() => setOpen(v => !v)}>
            {open ? '▾' : '▸'} Also reading: {away.slice(0, 3).map(x => baseName(x.file)).join(', ')}
            {away.length > 3 ? ` +${away.length - 3}` : ''}
          </button>
          {open && (
            <ul className="gaze-away">
              {away.slice(0, 30).map(x => (
                <li key={`${x.act}:${x.file}`} style={{ '--gz': x.color } as CSSProperties}>
                  <span className="gaze-dot-mini" />
                  {x.act === 'search' ? (
                    // A search names a folder: shown, never opened.
                    <span className="gaze-file" title={x.file}>Searched in {baseName(x.file)}/</span>
                  ) : (
                    <button className="gaze-file" title={`Open ${x.file}`} onClick={() => env.post({ type: 'open', file: x.file, line: x.line ?? 1 })}>
                      {x.act === 'edit' ? 'Edited ' : ''}
                      {baseName(x.file)}
                      {x.line ? `:${x.line}` : ''}
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  )

  const toggle: ReactNode = (
    <button
      className={`icon-btn gaze-eye${on ? ' on' : ''}`}
      aria-pressed={on}
      onClick={() => setOn(v => !v)}
      title={on ? 'Hide where agents are looking on this canvas' : 'Show where agents are looking on this canvas'}
    >
      <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
        <path d="M1.5 8s2.4-4.5 6.5-4.5S14.5 8 14.5 8s-2.4 4.5-6.5 4.5S1.5 8 1.5 8z" fill="none" stroke="currentColor" strokeWidth="1.3" />
        <circle cx="8" cy="8" r="2" fill="currentColor" />
        {!on && <path d="M2.5 13.5l11-11" stroke="currentColor" strokeWidth="1.3" />}
      </svg>
    </button>
  )

  return { toggle, flowLayer, overlay, on }
}

/** One agent's dot: on the line it reads (or the card's header), gliding between cards, pulsing once on an edit. */
function Dot({ marker, index, instant }: { marker: Marker; index: number; instant: boolean }) {
  const rf = useReactFlow()
  const card = rf.getNode(marker.key)
  const pulse = useRef(marker.edits)
  const [pulsing, setPulsing] = useState(0)
  useEffect(() => {
    if (marker.edits !== pulse.current) {
      pulse.current = marker.edits
      setPulsing(p => p + 1)
    }
  }, [marker.edits])
  if (!card) return null
  const data = card.data as CardData
  const w = Number(card.style?.width) || 400
  const y = marker.line === undefined ? undefined : lineY(data.rows ?? [], marker.line, HEADER_H + (data.chipsH ?? 0) + CODE_PAD, LINE_H)
  // Several agents on one card sit side by side instead of on top of each other.
  const x = card.position.x + w - 22 - index * 18
  const top = card.position.y + (y ?? HEADER_H / 2)
  return (
    <div
      className={`gaze-marker${instant ? ' instant' : ''}`}
      style={{ transform: `translate(${x}px, ${top}px)`, '--gz': marker.color } as CSSProperties}
      title={`${marker.label} is here`}
      aria-hidden="true"
    >
      <span key={pulsing} className={`gaze-dot${pulsing ? ' pulse' : ''}`}><Arrow size={14} /></span>
    </div>
  )
}
