// The ghost cursor: the agent's arrow, gliding to each step's card. It lives in flow coordinates (inside the viewport portal),
// so it pans and zooms with the canvas. Each move happens once and ends in a single tap on the card; it never idles or wiggles.
import { useLayoutEffect, useRef, type CSSProperties } from 'react'
import { Arrow } from './Arrow'
import { glidePath, type Pt } from './geometry'

export const GLIDE_MS = 600
const TAP_MS = 240

const at = (p: Pt) => `translate(${Math.round(p.x)}px, ${Math.round(p.y)}px)`

/**
 * `seq` changes once per move; `stops` are the points it passes (the card's header, then the line). Without a colour it is the
 * canvas's own pointer. Under reduced motion (or a hidden canvas) it jumps instead of gliding, and does not tap.
 */
export function Cursor({ seq, stops, agent, visible, instant }: { seq: number; stops: Pt[]; agent?: { label: string; color: string }; visible: boolean; instant: boolean }) {
  const el = useRef<HTMLDivElement>(null)
  const tip = useRef<HTMLDivElement>(null)
  const last = useRef<Pt | null>(null)
  useLayoutEffect(() => {
    const node = el.current
    const end = stops.at(-1)
    if (!node || !end) return
    node.style.transform = at(end)
    if (!instant) {
      if (last.current) {
        node.animate(
          glidePath(last.current, stops).map(k => ({ transform: at(k), offset: k.offset })),
          { duration: GLIDE_MS, easing: 'cubic-bezier(.4, 0, .2, 1)' },
        )
      }
      // The tap: the arrow presses into the card where it lands, the way a hand points at a line.
      tip.current?.animate(
        [{ transform: 'scale(1)' }, { transform: 'scale(.78)', offset: .45 }, { transform: 'scale(1)' }],
        { duration: TAP_MS, delay: last.current ? GLIDE_MS : 0, easing: 'ease-out' },
      )
    }
    last.current = end
  }, [seq]) // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div ref={el} className={`tour-cursor${visible && stops.length ? ' on' : ''}`} style={agent ? ({ '--ink': agent.color } as CSSProperties) : undefined} aria-hidden="true">
      <div ref={tip} className="tour-cursor-tip"><Arrow size={26} /></div>
      {agent && <span className="tour-cursor-name">{agent.label}</span>}
    </div>
  )
}
