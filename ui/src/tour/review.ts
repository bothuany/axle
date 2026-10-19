// The canvas's "Review N changes" as a tour: one step per changed card, in call order. The Keep/Undo buttons stay
// extra actions of the bar for this source only. Pure, with only type imports (tested under plain Node, ui/test).
import type { FlowNode, Tour, TourStep } from '../types'

/** Added lines as a few `[from, to]` ranges (adjacent lines merge). Three at most: the rest is the card's own green. */
export function rangesOf(lines: readonly number[], max = 3): [number, number][] {
  const out: [number, number][] = []
  for (const n of [...lines].sort((a, b) => a - b)) {
    const last = out[out.length - 1]
    if (last && n <= last[1] + 1) last[1] = Math.max(last[1], n)
    else out.push([n, n])
  }
  return out.slice(0, max)
}

const dotted = (label: string) => label.replace(/\s*▸\s*/g, '.')

function stepOfChange(n: FlowNode): TourStep {
  const d = n.diff!
  const what = d.base ? `Changed since ${d.base}` : d.source === 'git' ? 'Uncommitted change' : 'Agent edit'
  const label = dotted(n.label)
  return {
    title: label,
    caption: `${what}: ${d.plus} ${d.plus === 1 ? 'line' : 'lines'} added, ${d.minus} removed.`,
    at: { file: n.file ?? '', startLine: n.startLine, endLine: n.endLine, label },
    highlights: rangesOf(d.added),
    state: 'ok',
  }
}

/**
 * `changed`: the drawn changed cards in call order (the outermost caller first, then down the flow). `keys` are the cards the
 * steps were made from, by index: the player prefers that copy when a method is drawn twice. They never leave the canvas.
 */
export function tourFromChanges(changed: readonly FlowNode[]): { tour: Tour; keys: string[] } {
  const own = changed.filter(n => n.diff && n.file)
  const tour: Tour = { id: 'review', title: 'Review changes', origin: 'Review changes', source: 'review', steps: own.map(stepOfChange), start: 0 }
  return { tour, keys: own.map(n => n.key) }
}

/** The review re-syncs its steps only when this differs: the cards it points at, and what each says. */
export const reviewSignature = (changed: readonly FlowNode[]) => changed.map(n => `${n.key}:${n.startLine}:${n.diff?.plus}:${n.diff?.minus}`).join('|')
