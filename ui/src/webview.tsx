// Flow canvas as a VS Code webview: callers on the left, the method in the middle, callees on the right.
// All data comes through the extension host (which picks Roslyn, LSP, … per language); edits are applied
// by the host to the real document, so undo and the agent's Keep/Undo stay consistent.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { Background, BackgroundVariant, Controls, MiniMap, ReactFlow, ReactFlowProvider, useReactFlow } from '@xyflow/react'
import * as monaco from 'monaco-editor'
import editorWorker from 'monaco-editor/editor/editor.worker?worker&inline'
import '@xyflow/react/dist/style.css'
import './styles.css'
import './webview.css'
import { HEADER_H, initialHidden, layout, layoutCallers, setEditMaxWidth, type EditTarget } from './layout'
import { ActionsCtx, nodeTypes, type CanvasActions, type Caret } from './nodes'
import type { FlowNode } from './types'

declare function acquireVsCodeApi(): { postMessage(msg: unknown): void }
/** What to draw: opaque to the webview, interpreted by the host's provider for that language. */
type Target = Record<string, unknown>
declare global {
  interface Window {
    __FLOW__: { target: Target; label: string; dark: boolean }
  }
}

self.MonacoEnvironment = { getWorker: () => new editorWorker() }
monaco.editor.setTheme(window.__FLOW__.dark ? 'vs-dark' : 'vs')
const vscode = acquireVsCodeApi()

// ---- request/response over postMessage ------------------------------------------------------
let seq = 0
const pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>()
function request<T>(op: string, payload: Record<string, unknown>): Promise<T> {
  const id = ++seq
  vscode.postMessage({ type: 'request', id, op, ...payload })
  return new Promise<T>((resolve, reject) => pending.set(id, { resolve: v => resolve(v as T), reject }))
}
window.addEventListener('message', e => {
  const m = e.data
  if (m?.type !== 'response') return
  const p = pending.get(m.id)
  pending.delete(m.id)
  if (m.error) p?.reject(new Error(m.error))
  else p?.resolve(m.data)
})

function find(n: FlowNode | null, key: string): FlowNode | null {
  if (!n) return null
  if (n.key === key) return n
  for (const c of n.children) {
    const hit = find(c.node, key)
    if (hit) return hit
  }
  return null
}

interface TurnSummary {
  id: number
  prompt: string
  agent: string
  at: number
  files: { file: string; plus: number; minus: number }[]
}

const clock = (t: number) => new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })

/** Every prompt that changed code, oldest first. Pick one to see only its changes on the cards. */
function Timeline({ turns, active, onPick, onUndo }: { turns: TurnSummary[]; active?: number; onPick: (id?: number) => void; onUndo: (id: number) => void }) {
  return (
    <div className="tl" role="dialog" aria-label="Agent edits by prompt">
      <p className="tl-lead">Pick a prompt to see only what it changed.</p>
      <ol className="tl-list">
        {turns.map((t, i) => {
          const plus = t.files.reduce((a, f) => a + f.plus, 0)
          const minus = t.files.reduce((a, f) => a + f.minus, 0)
          return (
            <li key={t.id} className={`tl-turn${active === t.id ? ' on' : ''}`}>
              <button className="tl-pick" onClick={() => onPick(active === t.id ? undefined : t.id)} aria-pressed={active === t.id}>
                <span className="tl-meta">
                  <span className="tl-step">Prompt {i + 1}</span>
                  <span>{t.agent}</span>
                  <span>{clock(t.at)}</span>
                </span>
                <span className="tl-prompt">{t.prompt || 'No prompt text'}</span>
                <span className="tl-files">
                  {t.files.length} {t.files.length === 1 ? 'file' : 'files'} <b className="plus">+{plus}</b> <b className="minus">−{minus}</b>
                </span>
              </button>
              <button className="btn ghost tl-undo" onClick={() => onUndo(t.id)} title="Put the files back the way they were before this prompt">
                {i === turns.length - 1 ? 'Undo' : 'Undo from here'}
              </button>
            </li>
          )
        })}
      </ol>
      {active !== undefined && (
        <button className="btn ghost tl-all" onClick={() => onPick(undefined)}>
          Show all changes
        </button>
      )}
    </div>
  )
}

function Flow() {
  const [target, setTarget] = useState<{ target: Target; label: string }>({ target: window.__FLOW__.target, label: window.__FLOW__.label })
  const [down, setDown] = useState<FlowNode | null>(null)
  const [up, setUp] = useState<FlowNode | null>(null)
  const [showUp, setShowUp] = useState(true)
  const [hidden, setHidden] = useState<Set<string>>(new Set())
  const [full, setFull] = useState<Set<string>>(new Set())
  const [editing, setEditing] = useState<EditTarget>(null)
  const [status, setStatus] = useState('')
  const [error, setError] = useState('')
  const [caret, setCaret] = useState<Caret>()
  const [trace, setTrace] = useState<{ source: string; target: string } | null>(null)
  const [impactOpen, setImpactOpen] = useState(false)
  const [turns, setTurns] = useState<TurnSummary[]>([])
  const [turn, setTurn] = useState<number>()
  const [timelineOpen, setTimelineOpen] = useState(false)
  const [tour, setTour] = useState<number | null>(null)
  const [proposal, setProposal] = useState<{ id?: string; answerable?: boolean; agent: string; title: string; spans: { file: string; start: number; end: number }[]; files: string[] } | null>(null)
  const [editHooks, setEditHooks] = useState<string[]>([])
  const turnRef = useRef(turn)
  turnRef.current = turn
  const [impact, setImpact] = useState<{ label: string; items: string[] } | null>(null)
  const [selected, setSelected] = useState<string | null>(null)
  const { fitView, setCenter, getNode, getViewport } = useReactFlow()
  const editingRef = useRef(editing)
  editingRef.current = editing

  const load = useCallback(async (t: Target, keepFolds: boolean) => {
    try {
      const [d, u] = await Promise.all([request<FlowNode>('graph', { target: t, turn: turnRef.current }), request<FlowNode | null>('callers', { target: t, turn: turnRef.current })])
      request<TurnSummary[]>('timeline', {}).then(setTurns, () => setTurns([]))
      if (d.file) request<string[]>('editHooks', { file: d.file }).then(setEditHooks, () => setEditHooks([]))
      setDown(d)
      setUp(u)
      if (!keepFolds) {
        // Callees two levels deep, callers one level: enough to read, not enough to drown.
        setHidden(new Set([...initialHidden(d, 2), ...(u ? initialHidden(u, 1) : [])]))
        setFull(new Set())
        setEditing(null)
      }
      setStatus('')
      setError('')
      // Impact walks callers far up; it can take a moment, so it fills in after the canvas.
      if (!keepFolds) setImpact(null)
      request<{ label: string; items: string[] }>('impact', { target: t }).then(setImpact, () => setImpact(null))
    } catch (e) {
      setError(String((e as Error).message ?? e))
    }
  }, [])

  useEffect(() => {
    setDown(null)
    setUp(null)
    setError('')
    setImpactOpen(false)
    load(target.target, false)
  }, [target, load])

  // Picking a prompt in the timeline re-draws the cards with only that prompt's changes.
  const firstTurn = useRef(true)
  useEffect(() => {
    if (firstTurn.current) {
      firstTurn.current = false
      return
    }
    load(target.target, true)
  }, [turn]) // eslint-disable-line react-hooks/exhaustive-deps

  // Host messages: show another method, or refresh after a change on disk (unless mid-edit).
  useEffect(() => {
    const onMsg = (e: MessageEvent) => {
      const m = e.data
      if (m?.type === 'show') setTarget({ target: m.target, label: m.label })
      if (m?.type === 'refresh' && !editingRef.current) load(target.target, true)
      if (m?.type === 'cursor') followCursor(m.file, m.line)
      if (m?.type === 'proposal') setProposal(m.proposal)
    }
    window.addEventListener('message', onMsg)
    return () => window.removeEventListener('message', onMsg)
  }, [load, target]) // eslint-disable-line react-hooks/exhaustive-deps

  // Editor → canvas: highlight the innermost card holding the cursor; pan only if it is off-screen.
  const treesRef = useRef<{ down: FlowNode | null; up: FlowNode | null }>({ down: null, up: null })
  treesRef.current = { down, up }
  const followCursor = (file: string, line: number) => {
    let best: FlowNode | null = null
    const visit = (n: FlowNode | null) => {
      if (!n) return
      if (n.file === file && n.startLine <= line && line <= n.endLine && (!best || n.endLine - n.startLine < best.endLine - best.startLine)) best = n
      n.children.forEach(c => visit(c.node))
    }
    visit(treesRef.current.down)
    visit(treesRef.current.up)
    const hit = best as FlowNode | null
    setSelected(hit?.key ?? null)
    const card = hit && getNode(hit.key)
    if (!card) return
    const { x, y, zoom } = getViewport()
    const el = document.querySelector('.wv-canvas') as HTMLElement
    const sx = card.position.x * zoom + x
    const sy = card.position.y * zoom + y
    if (sx < 0 || sy < 0 || sx > el.clientWidth - 40 || sy > el.clientHeight - 40) {
      setCenter(card.position.x + 200, card.position.y + 120, { zoom, duration: 250 })
    }
  }

  /** The flow as text with exact spans — what the agent gets when you ask it about this flow. */
  const flowText = () => {
    const lines = [`# Flow: ${target.label}`, '', 'This is the call flow the user is looking at on the Flow canvas. The file:line ranges are exact; read them directly instead of searching.', '']
    const walk = (n: FlowNode, d: number, via: string) => {
      const loc = n.file ? ` — \`${n.file}:${n.startLine}-${n.endLine}\`` : ''
      lines.push(`${'  '.repeat(d)}- ${via}**${n.label}** (${n.kind})${loc}`)
      n.children.forEach(c => walk(c.node, d + 1, c.edgeKind === 'call' ? '' : `${c.edgeKind} → `))
    }
    if (up?.children.length) {
      lines.push('## Callers (upstream)')
      up.children.forEach(c => walk(c.node, 0, ''))
      lines.push('')
    }
    if (down) {
      lines.push('## Flow (downstream)')
      walk(down, 0, '')
    }
    if (impact?.items.length) lines.push('', `## Impact: ${impact.items.length} ${impact.label}${impact.items.length === 1 ? '' : 's'}`, ...impact.items.map(i => `- ${i}`))
    return lines.join('\n')
  }

  // Track the canvas width: an editing card is sized to fit inside it.
  const [canvasW, setCanvasW] = useState(900)
  useEffect(() => {
    const el = document.querySelector('.wv-canvas') as HTMLElement
    const ro = new ResizeObserver(() => setCanvasW(el.clientWidth))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const { nodes, edges } = useMemo(() => {
    if (!down) return { nodes: [], edges: [] }
    setEditMaxWidth(canvasW - 48)
    const d = layout(down, hidden, full, selected, new Set(), editing)
    if (!showUp || !up) return d
    const rootCard = d.nodes.find(n => n.id === down.key)
    const u = layoutCallers(up, down.key, rootCard?.position.y ?? 0, hidden, full, selected, new Set(), editing)
    return { nodes: [...d.nodes, ...u.nodes], edges: [...d.edges, ...u.edges] }
  }, [down, up, hidden, full, showUp, editing, selected, canvasW])

  // Fit the whole flow when it is still readable; otherwise open on the method you asked about,
  // at a zoom where its code can be read, with its callers' edge peeking in from the left.
  useEffect(() => {
    if (!down) return
    setTimeout(() => {
      const el = document.querySelector('.wv-canvas') as HTMLElement
      const xs = nodes.filter(n => n.type === 'card')
      const minX = Math.min(...xs.map(n => n.position.x))
      const maxX = Math.max(...xs.map(n => n.position.x + (Number(n.style?.width) || 0)))
      const minY = Math.min(...xs.map(n => n.position.y))
      const maxY = Math.max(...xs.map(n => n.position.y + (Number(n.style?.height) || 0)))
      const fit = Math.min(el.clientWidth / (maxX - minX + 80), el.clientHeight / (maxY - minY + 80))
      const root = getNode(down.key)
      if (fit >= 0.6 || !root) return fitView({ padding: 0.1, maxZoom: 1, duration: 250 })
      const zoom = 0.85
      setCenter(root.position.x - 60 + el.clientWidth / zoom / 2, root.position.y - 40 + el.clientHeight / zoom / 2, { zoom, duration: 250 })
    }, 50)
  }, [down?.symbolId, showUp]) // eslint-disable-line react-hooks/exhaustive-deps

  const actions = useMemo<CanvasActions>(
    () => ({
      toggle: key =>
        setHidden(h => {
          const next = new Set(h)
          if (next.has(key)) next.delete(key)
          else next.add(key)
          return next
        }),
      toggleAll: key =>
        setHidden(h => {
          const n = find(down, key) ?? find(up, key)
          if (!n) return h
          const next = new Set(h)
          const anyHidden = n.children.some(c => next.has(c.node.key))
          n.children.forEach(c => (anyHidden ? next.delete(c.node.key) : next.add(c.node.key)))
          return next
        }),
      toggleFull: key =>
        setFull(f => {
          const next = new Set(f)
          if (next.has(key)) next.delete(key)
          else next.add(key)
          return next
        }),
      open: key => {
        const n = find(down, key) ?? find(up, key)
        if (n?.file) vscode.postMessage({ type: 'open', file: n.file, line: n.startLine })
      },
      reveal: key => {
        const n = find(down, key) ?? find(up, key)
        setSelected(key)
        if (n?.file) vscode.postMessage({ type: 'reveal', file: n.file, line: n.startLine })
      },
      edit: (key, at) => {
        const n = find(down, key) ?? find(up, key)
        if (!n?.file) return
        setCaret(at)
        setSelected(key)
        setTrace(null)
        setEditing({ file: n.file, startLine: n.startLine })
        // Monaco needs an untransformed canvas: put the card in view at 100% and keep it there while editing.
        // Keep the clicked line where it was on screen, so the jump to 100% feels like a zoom, not a move.
        setTimeout(() => {
          const card = getNode(key)
          if (!card) return
          const lineY = at ? HEADER_H + (at.line - n.startLine) * 18 : 160
          const el = document.querySelector('.wv-canvas') as HTMLElement
          // A card wider than the canvas keeps its left edge (line numbers, indentation) in view.
          const w = Number(card.style?.width) || 560
          setCenter(card.position.x + w / 2, card.position.y + Math.min(lineY, el.clientHeight / 2 - 40), { zoom: 1, duration: 220 })
        }, 30)
      },
      focusLine: (key, line) => {
        const n = find(down, key) ?? find(up, key)
        const card = getNode(key)
        if (!n || !card) return
        setSelected(key)
        const el = document.querySelector('.wv-canvas') as HTMLElement
        const w = Number(card.style?.width) || 400
        setCenter(card.position.x + Math.min(w / 2, el.clientWidth / 2 - 24), card.position.y + HEADER_H + (line - n.startLine) * 18, { zoom: 1, duration: 260 })
      },
      mention: key => {
        const n = find(down, key) ?? find(up, key)
        if (n?.file) vscode.postMessage({ type: 'mention', file: n.file, start: n.startLine - 1, end: n.endLine - 1 })
      },
      trace: (source, target) => setTrace(source && target ? { source, target } : null),
      caret,
      cancelEdit: () => setEditing(null),
      keep: async key => {
        const n = find(down, key) ?? find(up, key)
        if (!n?.file) return
        await request('keep', { file: n.file })
        await load(target.target, true)
      },
      undo: async key => {
        const n = find(down, key) ?? find(up, key)
        if (!n?.file) return
        const res = await request<{ ok: boolean; message?: string }>('undo', { file: n.file, startLine: n.startLine, endLine: n.endLine })
        if (!res.ok) setStatus(res.message ?? 'Could not undo the change.')
        await load(target.target, true)
      },
      save: async (key, code) => {
        const n = find(down, key) ?? find(up, key)
        if (!n?.file || n.code == null) return 'This card is gone. Refresh the flow and try again.'
        const res = await request<{ ok: boolean; message?: string }>('save', { file: n.file, startLine: n.startLine, endLine: n.endLine, original: n.code, code })
        if (!res.ok) return res.message ?? 'Could not save.'
        setEditing(null)
        await load(target.target, true)
        return undefined
      },
    }),
    [down, up, getNode, setCenter, load, target, caret],
  )

  // Changed cards in call order: the outermost caller first, then down the flow as it runs.
  const changed = useMemo(() => {
    const ups: { n: FlowNode; depth: number }[] = []
    const walkUp = (n: FlowNode, depth: number) => n.children.forEach(c => {
      if (c.node.diff) ups.push({ n: c.node, depth })
      walkUp(c.node, depth + 1)
    })
    if (up && showUp) walkUp(up, 1)
    const downs: FlowNode[] = []
    const walkDown = (n: FlowNode) => {
      if (n.diff) downs.push(n)
      n.children.forEach(c => !hidden.has(c.node.key) && walkDown(c.node))
    }
    if (down) walkDown(down)
    // Only cards that are drawn (from the layout itself: the canvas store may not have them yet).
    const drawn = new Set(nodes.map(n => n.id))
    return [...ups.sort((a, b) => b.depth - a.depth).map(x => x.n), ...downs].filter(n => drawn.has(n.key))
  }, [down, up, showUp, hidden, nodes]) // eslint-disable-line react-hooks/exhaustive-deps

  const goTo = useCallback((i: number) => {
    const n = changed[i]
    const card = n && getNode(n.key)
    if (!card) return
    setTour(i)
    setSelected(n.key)
    const el = document.querySelector('.wv-canvas') as HTMLElement
    const w = Number(card.style?.width) || 400
    const h = Number(card.style?.height) || 200
    setCenter(card.position.x + Math.min(w / 2, el.clientWidth / 2 - 24), card.position.y + Math.min(h / 2, el.clientHeight / 2 - 60), { zoom: 1, duration: 280 })
  }, [changed, getNode, setCenter])

  // A tour that ran out of changes (all kept or undone) ends; one that shrank stays in range.
  useEffect(() => {
    if (tour === null) return
    if (!changed.length) setTour(null)
    else if (tour >= changed.length) goTo(changed.length - 1)
  }, [changed.length]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (tour === null) return
    const onKey = (e: KeyboardEvent) => {
      if (editingRef.current) return
      if (e.key === ']' || e.key === 'ArrowRight') goTo(Math.min(tour + 1, changed.length - 1))
      else if (e.key === '[' || e.key === 'ArrowLeft') goTo(Math.max(tour - 1, 0))
      else if (e.key === 'Escape') setTour(null)
      else return
      e.preventDefault()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [tour, changed.length, goTo])

  const undoFrom = async (id: number) => {
    const res = await request<{ ok: boolean; message?: string }>('undoFrom', { turn: id })
    if (!res.ok) setStatus(res.message ?? 'Could not undo the changes.')
    setTurn(undefined)
    setTimelineOpen(false)
    await load(target.target, true)
  }

  // Cards an agent is asking to edit right now: the method holds a proposed diff span (or its whole file).
  const proposed = useMemo(() => {
    if (!proposal) return [] as FlowNode[]
    const drawn = new Set(nodes.map(n => n.id))
    const hits: FlowNode[] = []
    const visit = (n: FlowNode | null) => {
      if (!n) return
      if (n.file && (proposal.files.includes(n.file) || proposal.spans.some(sp => sp.file === n.file && sp.start <= n.endLine && sp.end >= n.startLine)) && drawn.has(n.key)) hits.push(n)
      n.children.forEach(c => visit(c.node))
    }
    visit(down)
    visit(up)
    return hits
  }, [proposal, down, up, nodes]) // eslint-disable-line react-hooks/exhaustive-deps
  const proposedCss = proposed.map(n => `.react-flow__node[data-id="${n.key}"] .card { outline: 1.5px dashed var(--fl-signal); outline-offset: 3px; }`).join('\n')

  // Bring the first marked card into view, so the question in the dialog has its answer on screen.
  useEffect(() => {
    const first = proposed[0]
    const card = first && getNode(first.key)
    if (!card) return
    const el = document.querySelector('.wv-canvas') as HTMLElement
    const { x, y, zoom } = getViewport()
    const sx = card.position.x * zoom + x
    const sy = card.position.y * zoom + y
    if (sx < 0 || sy < 0 || sx > el.clientWidth - 60 || sy > el.clientHeight - 60) {
      setCenter(card.position.x + (Number(card.style?.width) || 400) / 2, card.position.y + 120, { zoom: Math.max(zoom, 0.8), duration: 250 })
    }
  }, [proposed.map(n => n.key).join()]) // eslint-disable-line react-hooks/exhaustive-deps

  // While one prompt is picked, cards show that prompt's change only; Keep/Undo act on everything, so they wait.
  const cardActions = useMemo(() => ({ ...(turn === undefined ? actions : { ...actions, keep: undefined, undo: undefined }), editHooks }), [actions, turn, editHooks])
  const locked = !!editing
  const { owner, member } = (() => {
    const clean = target.label.replace(/\s*▸\s*/g, '.')
    const at = clean.lastIndexOf('.')
    return at > 0 ? { owner: clean.slice(0, at + 1), member: clean.slice(at + 1) } : { owner: '', member: clean }
  })()
  // Hovering a call line lights its wire and the card it reaches; plain CSS, so nothing re-lays out.
  const traceCss = trace
    ? `[data-testid="rf__edge-e-${trace.source}-${trace.target}"] path, [data-testid="rf__edge-u-${trace.source}-${trace.target}"] path { stroke-width: 2.4 !important; filter: drop-shadow(0 0 4px currentColor); }
       .react-flow__edge:not([data-testid$="-${trace.source}-${trace.target}"]) { opacity: .35; }
       .react-flow__node[data-id="${trace.target}"] .card { box-shadow: 0 0 0 1.5px var(--k), var(--fl-lift); }`
    : ''
  const impactCount = impact?.items.length ?? 0
  const impactText = impact && `${impactCount ? `Affects ${impactCount}` : 'No'} ${impact.label}${impactCount === 1 ? '' : 's'}`
  return (
    <div className="wv">
      <style>{traceCss + proposedCss}</style>
      <header className="wv-bar">
        <div className="wv-title" title={target.label}>
          <span className="owner">{owner}</span>
          <span className="member">{member}</span>
        </div>
        <button className="chip" aria-pressed={showUp} onClick={() => setShowUp(v => !v)} title="Show who calls this method, to the left">
          Callers
        </button>
        {impact ? (
          <span className="impact-wrap">
            <button className={`chip impact${impactCount ? ' hot' : ''}`} aria-expanded={impactOpen} disabled={!impactCount} onClick={() => setImpactOpen(v => !v)}>
              {impactText}
            </button>
            {impactOpen && (
              <div className="impact-pop" role="dialog" onMouseLeave={() => setImpactOpen(false)}>
                <p>Changing this method can change the behaviour of:</p>
                <ul>{impact.items.map(i => <li key={i}>{i}</li>)}</ul>
              </div>
            )}
          </span>
        ) : (
          down && <span className="chip ghosted">Checking impact…</span>
        )}
        {turns.length > 0 && (
          <span className="impact-wrap">
            <button className={`chip${turn !== undefined ? ' agent' : ''}`} aria-expanded={timelineOpen} onClick={() => setTimelineOpen(v => !v)} title="Agent edits, prompt by prompt">
              {turn !== undefined ? `Prompt ${turns.findIndex(t => t.id === turn) + 1} of ${turns.length}` : `${turns.length} ${turns.length === 1 ? 'prompt' : 'prompts'} changed code`}
            </button>
            {timelineOpen && <Timeline turns={turns} active={turn} onPick={id => setTurn(id)} onUndo={undoFrom} />}
          </span>
        )}
        {changed.length > 0 && tour === null && (
          <button className="chip agent" onClick={() => goTo(0)} title="Step through the changed cards in call order">
            Review {changed.length} {changed.length === 1 ? 'change' : 'changes'}
          </button>
        )}
        <span className="wv-spacer" />
        {status && <span className="wv-status">{status}</span>}
        <button className="icon-btn" onClick={() => load(target.target, true)} title="Trace the flow again">
          ↻
        </button>
        <button className="ask" disabled={!down} onClick={() => vscode.postMessage({ type: 'ask', label: target.label, context: flowText() })} title="Attach this flow to a new chat">
          Ask about this flow
        </button>
      </header>
      <div className={`wv-canvas${locked ? ' locked' : ''}`}>
        {!down && (
          <div className="wv-empty">
            {error ? (
              <>
                <p className="wv-empty-title">Could not trace this flow</p>
                <p className="wv-empty-body">{error}</p>
                <button className="btn solid" onClick={() => load(target.target, false)}>Try again</button>
              </>
            ) : (
              <>
                <span className="pulse" />
                <p className="wv-empty-body">Tracing calls from {member}…</p>
              </>
            )}
          </div>
        )}
        {proposal && (
          <div className="proposal" role="status">
            <span className="proposal-dot" />
            <span>
              {proposal.agent} wants to edit {proposed.length ? `${proposed.length} ${proposed.length === 1 ? 'method' : 'methods'} on this flow` : 'code outside this flow'}.{proposal.answerable ? '' : ' Answer in the dialog.'}
            </span>
            {proposal.answerable && (
              <>
                <button className="btn ghost" onClick={() => vscode.postMessage({ type: 'answer', id: proposal.id, accept: false })}>Reject</button>
                <button className="btn solid" onClick={() => vscode.postMessage({ type: 'answer', id: proposal.id, accept: true })}>Accept</button>
              </>
            )}
          </div>
        )}
        {tour !== null && changed[tour] && (
          <div className="tour" role="toolbar" aria-label="Review changes">
            <button className="icon-btn" onClick={() => goTo(Math.max(tour - 1, 0))} disabled={tour === 0} title="Previous change ([)">‹</button>
            <span className="tour-pos">{tour + 1} / {changed.length}</span>
            <button className="icon-btn" onClick={() => goTo(Math.min(tour + 1, changed.length - 1))} disabled={tour === changed.length - 1} title="Next change (])">›</button>
            <span className="tour-label">{changed[tour].label.replace(/\s*▸\s*/g, '.')}</span>
            {turn === undefined && (
              <>
                <button className="btn ghost" onClick={() => actions.undo?.(changed[tour].key)}>Undo</button>
                <button className="btn solid" onClick={() => actions.keep?.(changed[tour].key)}>Keep</button>
              </>
            )}
            <button className="icon-btn" onClick={() => setTour(null)} title="Stop reviewing (Esc)">×</button>
          </div>
        )}
        <ActionsCtx.Provider value={cardActions}>
          <ReactFlow
            nodes={nodes}
            edges={edges}
            nodeTypes={nodeTypes}
            nodesDraggable={false}
            nodesConnectable={false}
            nodesFocusable={false}
            edgesFocusable={false}
            minZoom={0.1}
            maxZoom={2}
            panOnDrag={!locked}
            zoomOnScroll={!locked}
            zoomOnPinch={!locked}
            zoomOnDoubleClick={false}
            proOptions={{ hideAttribution: true }}
          >
            <Background variant={BackgroundVariant.Dots} gap={20} size={1} />
            <Controls showInteractive={false} position="bottom-left" />
            <MiniMap pannable zoomable position="bottom-right" maskColor="var(--fl-mask)" nodeColor={n => (n.type === 'frame' ? 'transparent' : 'var(--fl-line-strong)')} nodeBorderRadius={3} />
          </ReactFlow>
        </ActionsCtx.Provider>
      </div>
    </div>
  )
}

createRoot(document.getElementById('root')!).render(
  <ReactFlowProvider>
    <Flow />
  </ReactFlowProvider>,
)
