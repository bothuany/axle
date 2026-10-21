// Callouts: notes pinned to a node or an edge, drawn as bubbles in a layer above the cards (same viewport transform as the
// edges). They never move a node: the layout is the same with or without them.
import { useMemo } from 'react'
import { useStore } from '@xyflow/react'
import type { Layout } from './model'
import { drawEdges } from './edges'

const WIDTH = 188
const CHARS = 31
const LINE = 13

/** Words wrapped to lines of at most `max` characters (a word longer than that is cut). */
export function wrap(text: string, max = CHARS): string[] {
  const lines: string[] = []
  let line = ''
  for (const raw of text.split(/\s+/).filter(Boolean)) {
    const word = raw.length > max ? raw.slice(0, max - 1) + '…' : raw
    if (line && line.length + 1 + word.length > max) {
      lines.push(line)
      line = word
    } else {
      line = line ? `${line} ${word}` : word
    }
  }
  if (line) lines.push(line)
  return lines.slice(0, 6)
}

export interface Bubble {
  key: string
  /** The point on the node or edge the note is about. */
  at: { x: number; y: number }
  box: { x: number; y: number; w: number; h: number }
  lines: string[]
  text: string
}

/** Places each callout above-right of its anchor, nudged down a row when two would sit on the same spot. */
export function placeBubbles(layout: Layout, direction: 'LR' | 'TB'): Bubble[] {
  const edges = new Map(drawEdges(layout, direction).map(e => [e.key, e]))
  const nodes = new Map(layout.nodes.map(n => [n.id, n]))
  const out: Bubble[] = []
  layout.callouts.forEach((c, i) => {
    const n = c.node ? nodes.get(c.node) : undefined
    const e = c.edge ? edges.get(c.edge) : undefined
    const at = n ? { x: n.box.x + n.box.w - 10, y: n.box.y } : e ? e.route.mid : undefined
    if (!at) return
    const lines = wrap(c.text)
    const h = lines.length * LINE + 12
    const box = { x: at.x + 16, y: at.y - h - 14, w: WIDTH, h }
    // Two bubbles on one spot: stack the later one above.
    while (out.some(b => Math.abs(b.box.x - box.x) < WIDTH && Math.abs(b.box.y - box.y) < Math.max(h, b.box.h))) box.y -= h + 6
    out.push({ key: `${i}`, at, box, lines, text: c.text })
  })
  return out
}

export function CalloutLayer({ layout, direction }: { layout: Layout; direction: 'LR' | 'TB' }) {
  const t = useStore(s => s.transform)
  const bubbles = useMemo(() => placeBubbles(layout, direction), [layout, direction])
  if (!bubbles.length) return null
  return (
    <svg className="be-layer co-layer" aria-hidden="true">
      <g transform={`translate(${t[0]} ${t[1]}) scale(${t[2]})`}>
        {bubbles.map(b => (
          <g key={b.key} className="co">
            <path className="co-tail" d={`M${b.at.x} ${b.at.y} L${b.box.x + 10} ${b.box.y + b.box.h}`} />
            <circle className="co-dot" cx={b.at.x} cy={b.at.y} r="3" />
            <rect className="co-box" x={b.box.x} y={b.box.y} width={b.box.w} height={b.box.h} rx="6" />
            <text className="co-text" x={b.box.x + 8} y={b.box.y + 15}>
              {b.lines.map((l, i) => <tspan key={i} x={b.box.x + 8} dy={i ? LINE : 0}>{l}</tspan>)}
            </text>
          </g>
        ))}
      </g>
    </svg>
  )
}
