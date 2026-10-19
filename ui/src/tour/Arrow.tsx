// The agent's mark: a short, tail-less arrow, drawn flat in the agent's colour with a dark rim. The tour cursor, the caption
// that speaks for it and the gaze marker all use this one shape, so the reader learns it once: this arrow is the agent.
import type { CSSProperties } from 'react'

/** The outline in a 20 x 22 box; the tip is at (2, 2), the point a glide aims at. */
export const ARROW = 'M2 2 L2 19.5 L7 15 L15.5 15 Z'

/** `ink` is the agent's colour; without one the arrow takes the tour's colour (`--tour-ink`). */
export function Arrow({ size = 20, ink, className }: { size?: number; ink?: string; className?: string }) {
  const style = ink ? ({ '--ink': ink } as CSSProperties) : undefined
  return (
    <svg className={`agent-arrow${className ? ` ${className}` : ''}`} width={size} height={size * 1.1} viewBox="0 0 20 22" style={style} aria-hidden="true">
      <path d={ARROW} />
    </svg>
  )
}
