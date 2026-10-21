// The numbers behind the tour's visuals: where a line sits on a card, where the caption goes, the cursor's path.
// Pure and free of the canvas's layout constants (they are passed in), so it runs under plain Node (ui/test).

export interface Pt { x: number; y: number }
export interface Box { x: number; y: number; w: number; h: number }

/** The vertical centre of a line inside a card, from the rows the card draws (a long method is shown as a skeleton with gaps). */
export function lineY(rows: readonly object[], line: number, top: number, lineH: number): number | undefined {
  const i = rows.findIndex(r => (r as { no?: number }).no === line)
  return i < 0 ? undefined : top + (i + 0.5) * lineH
}

/** The first line of the highlights, or the step's own line. */
export function firstLine(highlights: readonly [number, number][] | undefined, startLine: number): number {
  return highlights?.length ? Math.min(...highlights.map(h => Math.min(h[0], h[1] ?? h[0]))) : startLine
}

/** Every line number a step highlights, each range capped so a wrong 1–99999 cannot build a huge selector. */
export function highlightedLines(highlights: readonly [number, number][] | undefined, cap = 80): number[] {
  const out = new Set<number>()
  for (const [a, b = a] of highlights ?? []) {
    const from = Math.max(1, Math.min(a, b))
    for (let n = from; n <= Math.max(a, b) && n < from + cap; n++) out.add(n)
  }
  return [...out].sort((x, y) => x - y)
}

export const CAPTION_W = 360
export const CAPTION_H = 150
/** The most the bubble grows to (it scrolls beyond that) and the room the tour bar takes at the bottom. */
export const BUBBLE_MAX_H = 440
export const BAR_RESERVE = 64
const GAP = 14
const EDGE = 8

/**
 * Where the caption bubble goes, in canvas pixels: to the right of the card, else to its left, else below it, else over
 * the card's top right; always clamped inside the canvas. `reserve`: height at the bottom the tour bar takes.
 */
export function captionPlace(card: Box, canvas: { w: number; h: number }, reserve = 64, size = { w: CAPTION_W, h: CAPTION_H }): { left: number; top: number; side: 'right' | 'left' | 'below' | 'over' } {
  const maxTop = Math.max(EDGE, canvas.h - reserve - size.h)
  const clampTop = (t: number) => Math.max(EDGE, Math.min(t, maxTop))
  const clampLeft = (l: number) => Math.max(EDGE, Math.min(l, canvas.w - size.w - EDGE))
  if (card.x + card.w + GAP + size.w + EDGE <= canvas.w) return { left: card.x + card.w + GAP, top: clampTop(card.y), side: 'right' }
  if (card.x - GAP - size.w >= EDGE) return { left: card.x - GAP - size.w, top: clampTop(card.y), side: 'left' }
  if (card.y + card.h + GAP + size.h <= canvas.h - reserve) return { left: clampLeft(card.x), top: card.y + card.h + GAP, side: 'below' }
  return { left: clampLeft(card.x + card.w - size.w), top: clampTop(card.y + 40), side: 'over' }
}

export interface Keyframe { x: number; y: number; offset: number }

/**
 * The cursor's path from where it was through `via` points: the first leg bows sideways a little, so it glides along a
 * curve instead of a ruler line. Each leg takes time in proportion to its length.
 */
export function glidePath(from: Pt, via: readonly Pt[]): Keyframe[] {
  const pts = [from, ...via]
  const len = (a: Pt, b: Pt) => Math.hypot(b.x - a.x, b.y - a.y)
  const total = pts.slice(1).reduce((sum, p, i) => sum + len(pts[i], p), 0) || 1
  const out: Keyframe[] = [{ ...from, offset: 0 }]
  let run = 0
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1]
    const b = pts[i]
    const d = len(a, b)
    if (i === 1 && d > 40) {
      // A control point at the middle, pushed to one side by a sixth of the distance.
      const nx = -(b.y - a.y) / d
      const ny = (b.x - a.x) / d
      out.push({ x: (a.x + b.x) / 2 + (nx * d) / 6, y: (a.y + b.y) / 2 + (ny * d) / 6, offset: (run + d / 2) / total })
    }
    run += d
    out.push({ x: b.x, y: b.y, offset: Math.min(1, run / total) })
  }
  out[out.length - 1].offset = 1
  return out
}
