// Edge geometry: where an edge leaves one box and enters another, its curve, arrowhead and label spots.
// Pure, so the canvas and the SVG export draw the same lines.
import { rowCentre, type Box, type VEdge, type VNode } from './model'
import { edgeStyle, type Head } from './protocol'

export interface Pt { x: number; y: number }

export interface Route {
  /** SVG path data of the line (it stops at the base of a triangle head). */
  d: string
  /** Arrowhead: SVG path data, and whether it is filled. */
  head?: { d: string; kind: Head }
  start: Pt
  end: Pt
  /** Unit vectors: leaving the source, and travelling into the target. */
  startDir: Pt
  endDir: Pt
  mid: Pt
}

const HEAD = 11
const f = (n: number) => Math.round(n * 10) / 10

function bezierAt(p0: Pt, p1: Pt, p2: Pt, p3: Pt, t: number): Pt {
  const u = 1 - t
  return {
    x: u * u * u * p0.x + 3 * u * u * t * p1.x + 3 * u * t * t * p2.x + t * t * t * p3.x,
    y: u * u * u * p0.y + 3 * u * u * t * p1.y + 3 * u * t * t * p2.y + t * t * t * p3.y,
  }
}

const unit = (dx: number, dy: number): Pt => {
  const l = Math.hypot(dx, dy) || 1
  return { x: dx / l, y: dy / l }
}

function headPath(tip: Pt, dir: Pt, kind: Head): string | undefined {
  if (kind === 'none') return undefined
  const size = kind === 'fill' ? 9 : HEAD
  const half = kind === 'vee' ? 5.5 : kind === 'fill' ? 4 : 5.5
  const bx = tip.x - dir.x * size
  const by = tip.y - dir.y * size
  const nx = -dir.y
  const ny = dir.x
  const l = `${f(bx + nx * half)} ${f(by + ny * half)}`
  const r = `${f(bx - nx * half)} ${f(by - ny * half)}`
  if (kind === 'vee') return `M${l} L${f(tip.x)} ${f(tip.y)} L${r}`
  return `M${f(tip.x)} ${f(tip.y)} L${l} L${r} Z`
}

export interface Anchors { from: VNode; to: VNode; edge: VEdge }

/**
 * `par`/`pars`: index and count of edges between the same two boxes, so parallel edges do not lie on top of each other.
 */
export function routeEdge(a: Anchors, dir: 'LR' | 'TB', par = 0, pars = 1): Route {
  const s: Box = a.from.box
  const t: Box = a.to.box
  const rowY = a.edge.fromRow !== undefined && a.from.node ? s.y + rowCentre(a.from.node, a.edge.fromRow) : undefined
  const off = (par - (pars - 1) / 2) * 9
  const tHead = a.to.node ? Math.min(t.y + 22, t.y + t.h / 2) : t.y + t.h / 2
  const style = edgeStyle(a.edge.kind)
  let start: Pt
  let end: Pt
  let c1: Pt
  let c2: Pt
  let startDir: Pt
  let endDir: Pt
  const self = a.from === a.to
  if (self) {
    const y = rowY ?? s.y + 22
    start = { x: s.x + s.w, y }
    end = { x: s.x + s.w, y: s.y + 24 + (rowY === undefined ? 12 : 0) }
    if (Math.abs(end.y - start.y) < 12) end = { x: end.x, y: start.y - 14 }
    c1 = { x: start.x + 46, y: start.y }
    c2 = { x: end.x + 46, y: end.y }
    startDir = { x: 1, y: 0 }
    endDir = { x: -1, y: 0 }
  } else if (dir === 'LR') {
    const sy = (rowY ?? s.y + (a.from.node ? Math.min(22, s.h / 2) : s.h / 2)) + (rowY === undefined ? off : 0)
    const ty = tHead + off
    if (t.x >= s.x + s.w + 10) {
      start = { x: s.x + s.w, y: sy }
      end = { x: t.x, y: ty }
      const k = Math.max(40, (end.x - start.x) / 2)
      c1 = { x: start.x + k, y: start.y }
      c2 = { x: end.x - k, y: end.y }
      startDir = { x: 1, y: 0 }
      endDir = { x: 1, y: 0 }
    } else if (t.x + t.w <= s.x - 10) {
      start = { x: s.x, y: sy }
      end = { x: t.x + t.w, y: ty }
      const k = Math.max(40, (start.x - end.x) / 2)
      c1 = { x: start.x - k, y: start.y }
      c2 = { x: end.x + k, y: end.y }
      startDir = { x: -1, y: 0 }
      endDir = { x: -1, y: 0 }
    } else {
      // Same column: leave and enter on the right and bulge outwards.
      start = { x: s.x + s.w, y: sy }
      end = { x: t.x + t.w, y: ty }
      const x = Math.max(start.x, end.x) + 56 + Math.abs(off)
      c1 = { x, y: start.y }
      c2 = { x, y: end.y }
      startDir = { x: 1, y: 0 }
      endDir = { x: -1, y: 0 }
    }
  } else {
    const sx = s.x + s.w / 2 + off
    const tx = t.x + t.w / 2 + off
    if (rowY !== undefined) {
      // A member row leaves through the side the target is on, and drops into the target's top or bottom.
      const right = t.x + t.w / 2 >= s.x + s.w / 2
      start = { x: right ? s.x + s.w : s.x, y: rowY }
      startDir = { x: right ? 1 : -1, y: 0 }
      const below = t.y + 4 >= rowY
      end = { x: tx, y: below ? t.y : t.y + t.h }
      endDir = { x: 0, y: below ? 1 : -1 }
      const k = Math.max(40, Math.abs(end.y - start.y) / 2)
      c1 = { x: start.x + startDir.x * k, y: start.y }
      c2 = { x: end.x, y: end.y - endDir.y * k }
    } else if (t.y >= s.y + s.h + 10) {
      start = { x: sx, y: s.y + s.h }
      end = { x: tx, y: t.y }
      const k = Math.max(36, (end.y - start.y) / 2)
      c1 = { x: start.x, y: start.y + k }
      c2 = { x: end.x, y: end.y - k }
      startDir = { x: 0, y: 1 }
      endDir = { x: 0, y: 1 }
    } else if (t.y + t.h <= s.y - 10) {
      start = { x: sx, y: s.y }
      end = { x: tx, y: t.y + t.h }
      const k = Math.max(36, (start.y - end.y) / 2)
      c1 = { x: start.x, y: start.y - k }
      c2 = { x: end.x, y: end.y + k }
      startDir = { x: 0, y: -1 }
      endDir = { x: 0, y: -1 }
    } else {
      start = { x: s.x + s.w, y: s.y + s.h / 2 + off }
      end = { x: t.x + t.w, y: t.y + t.h / 2 + off }
      const x = Math.max(start.x, end.x) + 56
      c1 = { x, y: start.y }
      c2 = { x, y: end.y }
      startDir = { x: 1, y: 0 }
      endDir = { x: -1, y: 0 }
    }
  }
  // The head's direction is how the curve arrives.
  const arrive = unit(end.x - c2.x, end.y - c2.y)
  const hd = style.head
  const tip = end
  const base = hd === 'tri' ? { x: tip.x - arrive.x * HEAD, y: tip.y - arrive.y * HEAD } : tip
  const mid = bezierAt(start, c1, c2, base, 0.5)
  return {
    d: `M${f(start.x)} ${f(start.y)} C${f(c1.x)} ${f(c1.y)} ${f(c2.x)} ${f(c2.y)} ${f(base.x)} ${f(base.y)}`,
    head: hd === 'none' ? undefined : { d: headPath(tip, arrive, hd)!, kind: hd },
    start,
    end: tip,
    startDir,
    endDir: arrive,
    mid,
  }
}

/** Where the cardinality text goes at each end: just off the line, on its left side. */
export function cardinalityAt(r: Route): { from: Pt; to: Pt } {
  const spot = (p: Pt, d: Pt, along: number) => ({ x: p.x + d.x * along - d.y * 9, y: p.y + d.y * along + d.x * 9 })
  return { from: spot(r.start, r.startDir, 14), to: spot(r.end, { x: -r.endDir.x, y: -r.endDir.y }, 14) }
}

/** Where the number badge of an edge sits: a little way along the line from its start, off the box edge. */
export const orderBadge = (r: Route) => ({ x: r.start.x + r.startDir.x * 18, y: r.start.y + r.startDir.y * 18 })

/** An open (vee) head at the tip of a route, for an asynchronous message. */
export function veeOf(r: Route): string {
  const size = 11
  const half = 5.5
  const bx = r.end.x - r.endDir.x * size
  const by = r.end.y - r.endDir.y * size
  const nx = -r.endDir.y
  const ny = r.endDir.x
  const f = (n: number) => Math.round(n * 10) / 10
  return `M${f(bx + nx * half)} ${f(by + ny * half)} L${f(r.end.x)} ${f(r.end.y)} L${f(bx - nx * half)} ${f(by - ny * half)}`
}
