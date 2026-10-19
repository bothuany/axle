// Which drawn card a tour step points at. A step names a file and a line, never a card: card keys are positional and
// change on every draw. Pure, with only type imports, so it is tested under plain Node (ui/test).
import type { FlowNode, TourStep } from '../types'

/** Paths from a backend (`C:\x\a.cs`) and from the editor (`c:\x\a.cs`, `c:/x/a.cs`) name the same file: compare them by this. */
export const samePath = (a: string, b: string) => {
  const key = (p: string) => p.replace(/\\/g, '/').replace(/^[A-Za-z]:/, d => d.toLowerCase())
  return key(a) === key(b)
}

type Trees = readonly (FlowNode | null)[]

function visit(trees: Trees, fn: (n: FlowNode) => void) {
  const walk = (n: FlowNode | null) => {
    if (!n) return
    fn(n)
    n.children.forEach(c => walk(c.node))
  }
  trees.forEach(walk)
}

/** The innermost card holding a line of a file (the one with the smallest span); the first drawn wins a tie. */
export function cardAt(trees: Trees, file: string, line: number): FlowNode | undefined {
  let best: FlowNode | undefined
  visit(trees, n => {
    if (n.file && samePath(n.file, file) && n.startLine <= line && line <= n.endLine && (!best || n.endLine - n.startLine < best.endLine - best.startLine)) best = n
  })
  return best
}

/** The database card of a table. */
export function cardOfTable(trees: Trees, table: string): FlowNode | undefined {
  let hit: FlowNode | undefined
  visit(trees, n => {
    if (!hit && n.schema && n.schema.table.toLowerCase() === table.toLowerCase()) hit = n
  })
  return hit
}

/** The cards from a tree's root down to `key`, or nothing when it is not in that tree. */
export function pathTo(root: FlowNode | null, key: string): FlowNode[] | undefined {
  if (!root) return undefined
  if (root.key === key) return [root]
  for (const c of root.children) {
    const below = pathTo(c.node, key)
    if (below) return [root, ...below]
  }
  return undefined
}

export type Target =
  | { kind: 'card'; node: FlowNode }
  /** The code is not on a drawn card: the step shows its own code (`peek`) beside the flow. */
  | { kind: 'peek' }
  /** Nothing to point at: an intro/outro step, or code that could not be found. The caption is still shown. */
  | { kind: 'none' }

/**
 * Where a step points. `prefer`: a card key the caller already knows (the review of changes), used when it still holds the
 * step's line, so the same method drawn twice stays the copy the review started on.
 */
export function resolveStep(trees: Trees, step: TourStep, prefer?: string): Target {
  const at = step.at
  if (!at || step.state === 'missing') return { kind: 'none' }
  let node: FlowNode | undefined
  if (at.table) node = cardOfTable(trees, at.table)
  else {
    visit(trees, n => {
      if (!node && n.key === prefer && n.file && samePath(n.file, at.file) && n.startLine <= at.startLine && at.startLine <= n.endLine) node = n
    })
    node ??= cardAt(trees, at.file, at.startLine)
    // No card holds the first line (a whole file, a range starting above its methods): the first card inside the range.
    if (!node && at.endLine > at.startLine) {
      visit(trees, n => {
        if (n.file && samePath(n.file, at.file) && at.startLine <= n.startLine && n.startLine <= at.endLine && (!node || n.startLine < node.startLine)) node = n
      })
    }
  }
  return node ? { kind: 'card', node } : step.peek ? { kind: 'peek' } : { kind: 'none' }
}
