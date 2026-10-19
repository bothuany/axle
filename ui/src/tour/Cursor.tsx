// The ghost cursor: a pointer in the agent's colour that glides to each step's card. It lives in flow coordinates (inside the
// viewport portal), so it pans and zooms with the canvas. Each move happens once; it never idles or wiggles.
import { useLayoutEffect, useRef, type CSSProperties } from 'react'
import { glidePath, type Pt } from './geometry'

export const GLIDE_MS = 600
const PING_MS = 700

/** A pointer with a short tail; its tip is the top-left corner (2, 1.5), the point the glide path aims at. */
const ARROW = 'M2 1.5 L2 19 L6.7 14.9 L9.9 22.4 L13 21 L9.8 13.6 L16.2 13.6 Z'

const at = (p: Pt) => `translate(${Math.round(p.x)}px, ${Math.round(p.y)}px)`

/**
 * `seq` changes once per move; `stops` are the points it passes (the card's header, then the line). Without a colour it is a
 * plain pointer. Under reduced motion (or a hidden canvas) it jumps instead of gliding.
 */
export function Cursor({ seq, stops, agent, visible, instant }: { seq: number; stops: Pt[]; agent?: { label: string; color: string }; visible: boolean; instant: boolean }) {
  const el = useRef<HTMLDivElement>(null)
  const ping = useRef<HTMLSpanElement>(null)
  const last = useRef<Pt | null>(null)
  useLayoutEffect(() => {
    const node = el.current
    const end = stops.at(-1)
    if (!node || !end) return
    node.style.transform = at(end)
    if (last.current && !instant) {
      node.animate(
        glidePath(last.current, stops).map(k => ({ transform: at(k), offset: k.offset })),
        { duration: GLIDE_MS, easing: 'cubic-bezier(.4, 0, .2, 1)' },
      )
    }
    // One ring where the pointer lands (after the glide, if there is one): the arrival is the only thing that ever moves besides the glide.
    if (!instant) ping.current?.animate(
      [{ transform: 'translate(-50%, -50%) scale(.3)', opacity: 0.85 }, { transform: 'translate(-50%, -50%) scale(2.4)', opacity: 0 }],
      { duration: PING_MS, delay: last.current ? GLIDE_MS : 0, easing: 'cubic-bezier(.2, .7, .3, 1)', fill: 'backwards' },
    )
    last.current = end
  }, [seq]) // eslint-disable-line react-hooks/exhaustive-deps
  const color = agent?.color ?? 'var(--fl-signal)'
  return (
    <div ref={el} className={`tour-cursor${visible && stops.length ? ' on' : ''}`} style={{ '--tc': color } as CSSProperties} aria-hidden="true">
      <span ref={ping} className="tour-cursor-ping" />
      <svg width="22" height="26" viewBox="0 0 22 26">
        <defs>
          <linearGradient id="tour-cursor-fill" x1="2" y1="1" x2="14" y2="22" gradientUnits="userSpaceOnUse">
            <stop offset="0" style={{ stopColor: 'color-mix(in srgb, var(--tc) 45%, #fff)' }} />
            <stop offset="0.55" style={{ stopColor: 'var(--tc)' }} />
            <stop offset="1" style={{ stopColor: 'color-mix(in srgb, var(--tc) 72%, #000)' }} />
          </linearGradient>
        </defs>
        <path d={ARROW} fill="url(#tour-cursor-fill)" stroke="#fff" strokeWidth="1.5" strokeLinejoin="round" />
        <path d={ARROW} fill="none" stroke="#0b0d12" strokeOpacity=".55" strokeWidth=".6" strokeLinejoin="round" />
        <path d="M3.8 4.4 L3.8 13.1 L6.3 10.9" fill="none" stroke="#fff" strokeOpacity=".55" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      {agent && <span className="tour-cursor-tag"><i aria-hidden="true" />{agent.label}</span>}
    </div>
  )
}
