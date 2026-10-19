// The ghost cursor: a pointer in the agent's colour that glides to each step's card. It lives in flow coordinates (inside the
// viewport portal), so it pans and zooms with the canvas. Each move happens once; it never idles or wiggles.
import { useLayoutEffect, useRef, type CSSProperties } from 'react'
import { glidePath, type Pt } from './geometry'

export const GLIDE_MS = 600

const at = (p: Pt) => `translate(${Math.round(p.x)}px, ${Math.round(p.y)}px)`

/**
 * `seq` changes once per move; `stops` are the points it passes (the card's header, then the line). Without a colour it is a
 * plain pointer. Under reduced motion (or a hidden canvas) it jumps instead of gliding.
 */
export function Cursor({ seq, stops, agent, visible, instant }: { seq: number; stops: Pt[]; agent?: { label: string; color: string }; visible: boolean; instant: boolean }) {
  const el = useRef<HTMLDivElement>(null)
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
    last.current = end
  }, [seq]) // eslint-disable-line react-hooks/exhaustive-deps
  const color = agent?.color ?? 'var(--fl-signal)'
  return (
    <div ref={el} className={`tour-cursor${visible && stops.length ? ' on' : ''}`} style={{ '--tc': color } as CSSProperties} aria-hidden="true">
      <svg width="20" height="22" viewBox="0 0 20 22">
        <path d="M1 1 L1 17 L5.2 13.2 L8.2 20 L10.9 18.8 L7.9 12.2 L13.6 12.2 Z" fill="var(--tc)" stroke="#fff" strokeWidth="1.2" strokeLinejoin="round" />
      </svg>
      {agent && <span className="tour-cursor-tag">{agent.label}</span>}
    </div>
  )
}
