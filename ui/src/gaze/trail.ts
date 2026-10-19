// The agent's gaze on the canvas: where each agent is reading now (a marker), which cards it visited (a fading trail) and the
// files it reads that no drawn card holds ("elsewhere"). Events name a file and lines, never a card: card keys change on every
// draw, so the cards are found again from the drawn trees whenever either changes. Pure, with only type imports (ui/test).
import type { FlowNode, GazeEvent } from '../types'

/** The trail fades over this long: the newest visit at full strength, one this old at TRAIL_MIN. */
export const TRAIL_MS = 60_000
export const TRAIL_MIN = 0.2
/** Events the canvas keeps, all agents together. */
export const KEEP = 600
/** More than this many events in one message is a burst: the marker jumps instead of gliding through every card. */
export const BURST = 20

const ACTS: readonly GazeEvent['act'][] = ['read', 'edit', 'search']
const obj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
const line = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v > 0 && v < 10_000_000

/** What the host sends is rebuilt field by field: the colour ends up in CSS, the label and file in text. */
export function sanitizeGaze(raw: unknown): GazeEvent[] {
  if (!Array.isArray(raw)) return []
  return raw.slice(0, KEEP).flatMap(e => {
    if (!obj(e) || typeof e.session !== 'string' || !e.session || typeof e.file !== 'string' || !e.file || !obj(e.agent)) return []
    const act = ACTS.find(a => a === e.act)
    const color = typeof e.agent.color === 'string' && /^#[0-9a-f]{3,8}$/i.test(e.agent.color) ? e.agent.color : null
    if (!act || !color) return []
    const ev: GazeEvent = {
      session: e.session.slice(0, 200),
      agent: { label: typeof e.agent.label === 'string' ? e.agent.label.slice(0, 40) : 'Agent', color },
      act,
      file: e.file.slice(0, 1000),
      at: typeof e.at === 'number' && Number.isFinite(e.at) ? e.at : 0,
    }
    if (act !== 'search' && line(e.startLine)) {
      ev.startLine = e.startLine
      if (line(e.endLine) && e.endLine >= e.startLine) ev.endLine = e.endLine
    }
    return [ev]
  })
}

/** The same rule as `samePath` in tour/cards.ts (kept here so this file has no value imports for the Node tests). */
const pathKey = (p: string) => p.replace(/\\/g, '/').replace(/^[A-Za-z]:/, d => d.toLowerCase())

type Trees = readonly (FlowNode | null)[]

/**
 * The drawn cards an event lands on. Lines inside one card: the innermost card that holds them all. Lines across several: every
 * card they touch. No lines (a whole-file read, a Write): every card of the file. A search names a folder and lands on none.
 */
export function cardsFor(trees: Trees, e: GazeEvent): FlowNode[] {
  if (e.act === 'search') return []
  const key = pathKey(e.file)
  const inFile: FlowNode[] = []
  const walk = (n: FlowNode | null) => {
    if (!n) return
    if (n.file && pathKey(n.file) === key && !inFile.some(m => m.key === n.key)) inFile.push(n)
    n.children.forEach(c => walk(c.node))
  }
  trees.forEach(walk)
  if (e.startLine === undefined) return inFile
  const from = e.startLine
  const to = e.endLine ?? from
  const holding = inFile.filter(n => n.startLine <= from && to <= n.endLine)
  if (holding.length) return [holding.reduce((a, b) => (b.endLine - b.startLine < a.endLine - a.startLine ? b : a))]
  return inFile.filter(n => n.startLine <= to && from <= n.endLine)
}

export interface TrailMark {
  /** The card's key in this draw. */
  key: string
  color: string
  /** 1 for a visit just now, down to TRAIL_MIN for one TRAIL_MS ago. An edited card keeps 1. */
  strength: number
  /** How many times it was read. */
  reads: number
  edited: boolean
}

export interface Marker {
  session: string
  label: string
  color: string
  key: string
  /** The line it reads, for placing the dot on the card; undefined for the whole card. */
  line?: number
  /** Bumps with each edit: the dot pulses once. */
  edits: number
}

export interface Elsewhere {
  file: string
  act: GazeEvent['act']
  line?: number
  color: string
  label: string
  at: number
}

export interface Agent {
  session: string
  label: string
  color: string
  last: number
}

export interface Paint {
  trail: TrailMark[]
  markers: Marker[]
  elsewhere: Elsewhere[]
  agents: Agent[]
}

/** How strong a visit `age` ms ago still shows. */
export const fade = (age: number) => Math.max(TRAIL_MIN, 1 - (1 - TRAIL_MIN) * Math.min(1, Math.max(0, age) / TRAIL_MS))

/**
 * Everything the gaze paints, for the cards drawn now. Events are oldest first. The trail holds visits of the last TRAIL_MS
 * (edits stay); the marker of each agent is on the card of its latest event that lands on one; the elsewhere list holds the
 * newest event of each file no drawn card holds, newest first.
 */
export function paint(events: readonly GazeEvent[], trees: Trees, now: number): Paint {
  const trail = new Map<string, TrailMark & { at: number }>()
  const markers = new Map<string, Marker>()
  const edits = new Map<string, number>()
  const elsewhere = new Map<string, Elsewhere>()
  const agents = new Map<string, Agent>()
  for (const e of events) {
    agents.set(e.session, { session: e.session, label: e.agent.label, color: e.agent.color, last: e.at })
    if (e.act === 'edit') edits.set(e.session, (edits.get(e.session) ?? 0) + 1)
    const cards = cardsFor(trees, e)
    if (!cards.length) {
      const k = `${e.act === 'search' ? 's' : 'f'}:${pathKey(e.file)}`
      elsewhere.delete(k)
      elsewhere.set(k, { file: e.file, act: e.act, line: e.startLine, color: e.agent.color, label: e.agent.label, at: e.at })
      continue
    }
    const first = cards[0]
    markers.set(e.session, { session: e.session, label: e.agent.label, color: e.agent.color, key: first.key, line: cards.length === 1 ? e.startLine : undefined, edits: edits.get(e.session) ?? 0 })
    const recent = now - e.at <= TRAIL_MS
    for (const c of cards) {
      const was = trail.get(c.key)
      const edited = e.act === 'edit' || !!was?.edited
      if (!recent && !edited) continue
      trail.set(c.key, {
        key: c.key,
        color: e.agent.color,
        at: e.at,
        strength: 0,
        reads: (was?.reads ?? 0) + (e.act === 'read' ? 1 : 0),
        edited,
      })
    }
  }
  return {
    trail: [...trail.values()].map(({ at, ...m }) => ({ ...m, strength: m.edited ? 1 : fade(now - at) })),
    markers: [...markers.values()],
    elsewhere: [...elsewhere.values()].reverse(),
    agents: [...agents.values()],
  }
}

/** A message's events added to the ones kept, the oldest dropped past KEEP. */
export function keep(events: readonly GazeEvent[], more: readonly GazeEvent[]): GazeEvent[] {
  const all = [...events, ...more]
  return all.length > KEEP ? all.slice(all.length - KEEP) : all
}

/** The file's name, for the elsewhere list. */
export const baseName = (file: string) => file.replace(/[\\/]+$/, '').split(/[\\/]/).pop() || file
