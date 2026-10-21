// Selection bar: select lines in a card's code and a small bar shows by the selection with what the agent can do with them: ask,
// explain (a tour), edit, or put them in the agent's prompt. It only reports which lines (selectedLines) and which action; the
// host builds what the agent is told. The buttons keep the mouse from taking focus so the selection survives the click.
import { useEffect, useRef, useState } from 'react'
import { selectedLines } from './PointAsk'

export type SelectionAction = 'ask' | 'explain' | 'edit' | 'mention'
export interface Picked {
  key: string
  startLine: number
  endLine: number
}

const ACTIONS: { id: SelectionAction; label: string; title: string }[] = [
  { id: 'ask', label: 'Ask', title: 'Ask the agent about the selected lines (?)' },
  { id: 'explain', label: 'Explain', title: 'Have the agent explain the selected lines as a tour' },
  { id: 'edit', label: 'Edit', title: 'Ask the agent to change the selected lines; the change comes back to keep or undo' },
  { id: 'mention', label: '@', title: 'Mention the selected lines in the agent’s prompt' },
]

export function SelectionBar({ hidden, onAct }: { hidden: boolean; onAct: (action: SelectionAction, picked: Picked) => void }) {
  const layer = useRef<HTMLDivElement>(null)
  const [at, setAt] = useState<{ picked: Picked; left: number; top: number } | null>(null)

  useEffect(() => {
    const update = () => {
      const sel = window.getSelection()
      const picked = selectedLines(sel)
      const host = layer.current?.getBoundingClientRect()
      if (!picked || !sel || !sel.rangeCount || !host) return setAt(null)
      const r = sel.getRangeAt(0).getBoundingClientRect()
      if (!r.width && !r.height) return setAt(null)
      // Above the selection when there is room, else below it; kept inside the canvas.
      const top = r.top - host.top > 40 ? r.top - host.top - 34 : r.bottom - host.top + 6
      setAt({ picked, left: Math.max(8, Math.min(r.left - host.left, host.width - 220)), top })
    }
    // A drag ends with mouseup; the keyboard changes it with selectionchange. Both settle on the final range.
    document.addEventListener('selectionchange', update)
    document.addEventListener('mouseup', update)
    return () => {
      document.removeEventListener('selectionchange', update)
      document.removeEventListener('mouseup', update)
    }
  }, [])

  return (
    <div className="tour-layer" ref={layer}>
      {at && !hidden && (
        <div className="sel-bar" style={{ left: at.left, top: at.top }} role="toolbar" aria-label="Agent actions for the selected code">
          {ACTIONS.map(a => (
            <button key={a.id} type="button" title={a.title} onMouseDown={e => e.preventDefault()} onClick={() => onAct(a.id, at.picked)}>
              {a.label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
