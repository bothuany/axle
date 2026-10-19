// A step whose code is on no drawn card: a lighter, dashed card beside the flow with the code the host sent. The tour never
// switches the flow under the reader; the peek card is only a place to point at.
import { CODE_PAD, HEADER_H, LINE_H } from '../layout'
import type { TourStep } from '../types'
import type { Box } from './geometry'

export const PEEK_W = 560
export const PEEK_MAX_LINES = 40

export function Peek({ step, box }: { step: TourStep; box: Box }) {
  const peek = step.peek!
  const lines = peek.code.replace(/\t/g, '    ').replace(/\r/g, '').split('\n').slice(0, PEEK_MAX_LINES)
  const lit = new Set<number>()
  for (const [a, b = a] of step.highlights ?? []) for (let n = Math.min(a, b); n <= Math.max(a, b) && n < a + 80; n++) lit.add(n)
  const file = step.at?.file.split(/[\\/]/).pop()
  return (
    <div className="tour-peek" style={{ left: box.x, top: box.y, width: box.w, height: box.h }}>
      <div className="tour-peek-head" style={{ height: HEADER_H }}>
        <span className="tour-peek-tag">Not on this flow</span>
        <div className="titles">
          <div className="title"><span className="member">{step.at?.label}</span></div>
          <div className="sub">{file}:{step.at?.startLine}</div>
        </div>
      </div>
      <div className="code" style={{ paddingTop: CODE_PAD, paddingBottom: CODE_PAD }}>
        {lines.map((text, i) => (
          <div key={i} className={`ln${lit.has(peek.startLine + i) ? ' tour-lit' : ''}`} style={{ height: LINE_H }}>
            <span className="gutter">{peek.startLine + i}</span>
            <span className="src">{text}</span>
          </div>
        ))}
      </div>
    </div>
  )
}
