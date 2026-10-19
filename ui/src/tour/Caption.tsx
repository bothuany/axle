// The caption bubble. Its text is plain text: the only formatting is a `code` span, rendered as a React element by splitting
// the string. There is no HTML, no Markdown link and no image, so a caption an agent wrote cannot reach the page as markup.
import { useState, type CSSProperties } from 'react'
import type { TourStep } from '../types'
import { captionParts, stepMark } from './player'

/** A caption longer than this is cut to three lines, with "more". */
const LONG = 170

export function Caption({ step, place }: { step: TourStep; place: { left: number; top: number; side: string } | 'centre' }) {
  const [open, setOpen] = useState(false)
  const mark = stepMark(step)
  const long = step.caption.length > LONG
  const style: CSSProperties = place === 'centre' ? { left: 0, right: 0, top: '18%', margin: '0 auto' } : { left: place.left, top: place.top }
  return (
    <div className={`tour-caption${step.state === 'missing' ? ' missing' : ''}`} data-side={place === 'centre' ? 'centre' : place.side} style={style} role="status" aria-live="polite">
      <div className="tour-caption-head">
        <b>{step.title}</b>
        {step.at && <span className="tour-mark" title={mark.label}>{mark.glyph}</span>}
      </div>
      <p className={`tour-caption-text${long && !open ? ' clamp' : ''}`}>
        {captionParts(step.caption).map((p, i) => (p.code ? <code key={i}>{p.text}</code> : <span key={i}>{p.text}</span>))}
      </p>
      {long && (
        <button className="tour-more" onClick={() => setOpen(v => !v)}>
          {open ? 'less' : 'more'}
        </button>
      )}
      {step.state === 'missing' && <p className="tour-warn">Can't find this code any more.</p>}
      {step.drift && step.state !== 'missing' && <p className="tour-warn">The code changed since this tour was made.</p>}
      {step.notes?.map((n, i) => (
        <div key={i} className="tour-note">
          {n.question && <p className="tour-q">{n.question}</p>}
          <p>{n.text}</p>
          <span className="tour-from">{n.by === 'agent' ? 'from the agent' : 'your note'}</span>
        </div>
      ))}
    </div>
  )
}
