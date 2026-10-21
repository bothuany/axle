// Point-and-ask: the reader points at a card (its "?" tool, Alt+click, or `?` with lines selected in its code) and asks the agent
// about it. A small box opens at the card; the question goes to the host as `pointAsk` (a file, lines and the text), and the
// agent's answer comes back as a tour on this same canvas.
import { useEffect, useRef, useState } from 'react'
import { useReactFlow, useStore, useViewport } from '@xyflow/react'
import { HEADER_H } from '../layout'

export interface Pointing {
  key: string
  file: string
  startLine: number
  endLine: number
  label: string
  /** Asking about the lines, or asking the agent to change them. */
  kind?: 'ask' | 'edit'
}

/** The lines selected in one card's code, by the `data-line` of the rows the selection starts and ends in. */
export function selectedLines(sel: Selection | null): { key: string; startLine: number; endLine: number } | undefined {
  if (!sel || sel.isCollapsed || !sel.anchorNode || !sel.focusNode) return undefined
  const row = (n: Node) => (n instanceof Element ? n : n.parentElement)?.closest<HTMLElement>('.ln[data-line]') ?? null
  const a = row(sel.anchorNode)
  const b = row(sel.focusNode)
  const card = a?.closest('.react-flow__node')
  const key = card?.getAttribute('data-id')
  if (!a || !b || !card || !key || card !== b.closest('.react-flow__node')) return undefined
  const [startLine, endLine] = [Number(a.dataset.line), Number(b.dataset.line)].sort((x, y) => x - y)
  return Number.isInteger(startLine) && Number.isInteger(endLine) ? { key, startLine, endLine } : undefined
}

const WIDTH = 360

export function PointAsk({ pointing, onSend, onClose }: { pointing: Pointing; onSend: (question: string) => void; onClose: () => void }) {
  const rf = useReactFlow()
  const { x, y, zoom } = useViewport()
  const w = useStore(s => s.width)
  const h = useStore(s => s.height)
  const [question, setQuestion] = useState('')
  const input = useRef<HTMLInputElement>(null)
  useEffect(() => input.current?.focus(), [pointing.key])
  const card = rf.getNode(pointing.key)
  if (!card) return null
  // Just under the card's header, kept inside the canvas.
  const left = Math.max(8, Math.min(card.position.x * zoom + x + 12, w - WIDTH - 8))
  const top = Math.max(8, Math.min(card.position.y * zoom + y + (HEADER_H + 4) * zoom, h - 120))
  const edit = pointing.kind === 'edit'
  const lines = pointing.startLine === pointing.endLine ? `line ${pointing.startLine}` : `lines ${pointing.startLine}-${pointing.endLine}`
  return (
    <div className="tour-layer">
      <form
        className="point-ask"
        style={{ left, top, width: WIDTH }}
        role="dialog"
        aria-label={edit ? 'Ask the agent to change this code' : 'Ask the agent about this code'}
        onSubmit={e => {
          e.preventDefault()
          if (question.trim()) onSend(question)
        }}
      >
        <div className="point-ask-what">
          <b>{pointing.label}</b> · {lines}
        </div>
        <input
          ref={input}
          value={question}
          maxLength={1000}
          placeholder={edit ? 'How should it change?' : 'Ask about this code…'}
          aria-label={edit ? 'What to change' : 'Your question'}
          onChange={e => setQuestion(e.target.value)}
          onKeyDown={e => e.key === 'Escape' && (e.stopPropagation(), onClose())}
        />
        <div className="point-ask-actions">
          <button type="button" className="btn ghost" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn solid" disabled={!question.trim()}>{edit ? 'Edit' : 'Ask'}</button>
        </div>
      </form>
    </div>
  )
}
