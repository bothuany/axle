// The tour bar: back, "3 / 7" (a step list), next, pause, the step's title, the source's own actions (Keep/Undo for a review of
// changes) and exit. The reader steps by hand; there is no autoplay timer.
import { useState, type ReactNode } from 'react'
import type { Tour } from '../types'
import { stepMark, type PlayerState } from './player'

export interface TourApi {
  next(): void
  back(): void
  goto(index: number): void
  toggle(): void
  exit(): void
}

export function TourBar({ tour, state, api, extras }: { tour: Tour; state: PlayerState; api: TourApi; extras?: ReactNode }) {
  const [list, setList] = useState(false)
  const { index, paused } = state
  const step = tour.steps[index]
  const last = tour.steps.length - 1
  return (
    <div className={`tour${paused ? ' paused' : ''}`} role="toolbar" aria-label={tour.title}>
      <button className="icon-btn" onClick={api.back} disabled={index === 0} title="Previous step (←)">‹</button>
      <span className="tour-steps">
        <button className="tour-pos" onClick={() => setList(v => !v)} aria-expanded={list} title="All steps">{index + 1} / {tour.steps.length}</button>
        {list && (
          <ol className="tour-list" aria-label={`Steps of ${tour.title}`}>
            <li className="tour-list-head" title={tour.origin}>{tour.title}</li>
            {tour.steps.map((s, i) => {
              const mark = stepMark(s)
              return (
                <li key={i}>
                  <button className={`tour-item${i === index ? ' on' : ''}`} onClick={() => { api.goto(i); setList(false) }}>
                    <span className="tour-mark" title={mark.label}>{mark.glyph}</span>
                    <span className="tour-item-title">{s.title}</span>
                  </button>
                </li>
              )
            })}
          </ol>
        )}
      </span>
      <button className="icon-btn" onClick={api.next} disabled={index === last} title="Next step (→)">›</button>
      <button className="icon-btn" onClick={api.toggle} title={paused ? 'Resume the tour (Space)' : 'Pause: lift the spotlight (Space)'}>{paused ? '▶' : '⏸'}</button>
      <span className="tour-label" title={`${tour.title} · ${tour.origin}`}>
        {step?.title}
        {paused && <span className="tour-paused"> · paused</span>}
      </span>
      {extras}
      <button className="icon-btn" onClick={api.exit} title="Close the tour (Esc)">×</button>
    </div>
  )
}
