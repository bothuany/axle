import { memo, useContext, useEffect, useRef, useState, createContext, type CSSProperties, type MouseEvent, type PointerEvent } from 'react'
import { Handle, Position, useStore, type NodeProps, type Node } from '@xyflow/react'
import * as monaco from 'monaco-editor'
import { CODE_PAD, HEADER_H, KIND_COLOR, LINE_H, SCHEMA_MAX, SCHEMA_OPS_H, SCHEMA_ROW, type CardData, type FrameData } from './layout'
import type { DbSchema, Kind } from './types'

/** Where a click on a card's code landed, in file coordinates (1-based), so editing starts right there. */
export interface Caret {
  line: number
  column: number
}

export interface CanvasActions {
  toggle: (childKey: string) => void
  toggleAll: (nodeKey: string) => void
  open: (nodeKey: string) => void
  toggleFull: (nodeKey: string) => void
  /** Inline editing on the card (VS Code webview). Absent in hosts that edit elsewhere. */
  edit?: (nodeKey: string, caret?: Caret) => void
  save?: (nodeKey: string, code: string) => Promise<string | undefined>
  cancelEdit?: () => void
  /** Show the method in the editor without leaving the canvas. */
  reveal?: (nodeKey: string) => void
  keep?: (nodeKey: string) => void
  undo?: (nodeKey: string) => void
  /** Zoomed out: bring this line to a readable size instead of editing it straight away. */
  focusLine?: (nodeKey: string, line: number) => void
  /** A call line is hovered: light the wire from `source` to `target` (null clears). */
  trace?: (source: string | null, target?: string) => void
  /** Hooks set to run after every agent edit in this workspace (shown on the review bar). */
  editHooks?: string[]
  /** Put this method into the prompt of a connected Claude Code terminal. */
  mention?: (nodeKey: string) => void
  /** Where editing should put the cursor (set by `edit`). */
  caret?: Caret
}
export const ActionsCtx = createContext<CanvasActions>({ toggle() {}, toggleAll() {}, open() {}, toggleFull() {} })

const LANG_BY_EXT: Record<string, string> = {
  cs: 'csharp', ts: 'typescript', tsx: 'typescript', js: 'javascript', jsx: 'javascript', mjs: 'javascript',
  java: 'java', kt: 'kotlin', py: 'python', go: 'go', rs: 'rust', rb: 'ruby', php: 'php', swift: 'swift', cpp: 'cpp', c: 'c',
}
export function langOf(file: string | null | undefined) {
  return LANG_BY_EXT[file?.split('.').pop()?.toLowerCase() ?? ''] ?? 'plaintext'
}

const KIND_NAME: Record<Kind, string> = {
  controller: 'entry point',
  handler: 'handler',
  method: 'method',
  db: 'database',
  ambiguous: 'several implementations',
  external: 'outside this workspace',
}

/** One shape per kind, so kinds stay readable without colour: ▶ entry, ◆ handler, ● method, cylinder db. */
function KindGlyph({ kind }: { kind: Kind }) {
  const c = KIND_COLOR[kind]
  const shape = {
    controller: <path d="M3 1.5 L10 6 L3 10.5 Z" fill={c} />,
    handler: <path d="M6 1 L11 6 L6 11 L1 6 Z" fill={c} />,
    method: <circle cx="6" cy="6" r="3.6" fill={c} />,
    db: (
      <g fill="none" stroke={c} strokeWidth="1.4">
        <ellipse cx="6" cy="3" rx="4" ry="1.6" fill={c} />
        <path d="M2 3 V9 C2 10.9 10 10.9 10 9 V3" />
      </g>
    ),
    ambiguous: <path d="M6 1.5 L10.5 6 L6 10.5 L1.5 6 Z" fill="none" stroke={c} strokeWidth="1.4" strokeDasharray="2 1.5" />,
    external: <circle cx="6" cy="6" r="3.6" fill="none" stroke={c} strokeWidth="1.4" />,
  }[kind]
  return (
    <svg className="glyph" width="12" height="12" viewBox="0 0 12 12" aria-label={KIND_NAME[kind]}>
      <title>{KIND_NAME[kind]}</title>
      {shape}
    </svg>
  )
}

/** "Orders.Service.Get" → owner "Orders.Service", member "Get": the member is what you read first. */
function splitLabel(label: string) {
  const clean = label.replace(/\s*▸\s*/g, '.')
  const at = clean.lastIndexOf('.')
  return at > 0 ? { owner: clean.slice(0, at), member: clean.slice(at + 1) } : { owner: '', member: clean }
}

/** Monaco on the card. Lives in a fixed-zoom canvas (see webview) so clicks land where they look. */
function CardEditor({ code, file, startLine, caret, onSave, onCancel }: { code: string; file: string | null; startLine: number; caret?: Caret; onSave: (text: string) => Promise<string | undefined>; onCancel: () => void }) {
  const host = useRef<HTMLDivElement>(null)
  const editor = useRef<monaco.editor.IStandaloneCodeEditor>(undefined)
  const [error, setError] = useState<string>()
  const [saving, setSaving] = useState(false)
  const [dirty, setDirty] = useState(false)
  const [confirmDiscard, setConfirmDiscard] = useState(false)
  const save = async () => {
    const ed = editor.current
    if (!ed) return
    if (ed.getValue() === code) return onCancel()
    setSaving(true)
    const err = await onSave(ed.getValue())
    setSaving(false)
    setError(err)
  }
  const saveRef = useRef(save)
  saveRef.current = save
  const confirmRef = useRef(confirmDiscard)
  confirmRef.current = confirmDiscard

  useEffect(() => {
    const ed = (editor.current = monaco.editor.create(host.current!, {
      value: code,
      language: langOf(file),
      minimap: { enabled: false },
      fontSize: 12,
      lineHeight: LINE_H,
      fontFamily: getComputedStyle(document.documentElement).getPropertyValue('--fl-mono') || undefined,
      lineNumbers: n => String(n + startLine - 1),
      lineNumbersMinChars: 4,
      glyphMargin: false,
      folding: false,
      scrollBeyondLastLine: false,
      automaticLayout: true,
      renderLineHighlight: 'line',
      overviewRulerLanes: 0,
      scrollbar: { verticalScrollbarSize: 6, horizontalScrollbarSize: 6 },
      padding: { top: CODE_PAD },
    }))
    ed.onDidChangeModelContent(() => {
      setDirty(ed.getValue() !== code)
      setConfirmDiscard(false)
    })
    ed.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => saveRef.current())
    // Esc leaves at once when nothing changed; with changes it asks once, so a stray Esc never loses work.
    ed.addCommand(monaco.KeyCode.Escape, () => {
      if (ed.getValue() === code || confirmRef.current) onCancel()
      else setConfirmDiscard(true)
    })
    if (caret) {
      const pos = { lineNumber: Math.max(1, caret.line - startLine + 1), column: caret.column }
      ed.setPosition(pos)
      ed.revealPositionInCenterIfOutsideViewport(pos)
    }
    // The click that opened the editor is still being handled by the canvas; take focus after it settles.
    ed.focus()
    const timers = [setTimeout(() => ed.focus(), 30), setTimeout(() => ed.focus(), 260)]
    return () => {
      timers.forEach(clearTimeout)
      ed.dispose()
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="card-editor nodrag nowheel nopan">
      <div ref={host} className="card-editor-host" />
      <div className="card-editor-bar">
        {error ? (
          <span className="card-editor-msg err">{error}</span>
        ) : confirmDiscard ? (
          <span className="card-editor-msg warn">Unsaved changes. Press Esc again to discard them.</span>
        ) : (
          <span className="card-editor-msg">
            <kbd>⌘S</kbd> save <kbd>Esc</kbd> {dirty ? 'discard' : 'close'}
          </span>
        )}
        <button className="btn ghost" onClick={onCancel}>{dirty ? 'Discard' : 'Close'}</button>
        <button className="btn solid" disabled={saving || !dirty} onClick={() => saveRef.current()}>
          {saving ? 'Saving…' : 'Save'}
        </button>
      </div>
    </div>
  )
}

/** Operators that only shape a query and say nothing about what it does. */
const QUIET_OPS = new Set(['ConfigureAwait', 'AsQueryable', 'AsEnumerable'])

/**
 * A table as the query sees it: what the query does (its operators, in the order they run; reads in
 * teal, writes in coral), then the columns — key first, Oracle column names, type, nullability and
 * length — and the relations the entity can navigate.
 */
function SchemaBody({ schema }: { schema: DbSchema }) {
  const ops = schema.ops.filter(o => !QUIET_OPS.has(o))
  const cols = schema.columns.slice(0, SCHEMA_MAX)
  const more = schema.columns.length - cols.length
  return (
    <div className="schema">
      <div className="schema-ops" style={{ height: SCHEMA_OPS_H }}>
        <span className={`schema-verb ${schema.writes ? 'write' : 'read'}`}>{schema.writes ? 'writes' : 'reads'}</span>
        <span className="schema-chain" title={schema.ops.join(' → ')}>{ops.join(' → ') || 'whole table'}</span>
      </div>
      {cols.map(c => (
        <div key={c.name} className={`schema-col${c.key ? ' key' : ''}`} style={{ height: SCHEMA_ROW }} title={c.column !== c.name ? `${c.name} → ${c.column}` : c.name}>
          <span className="schema-mark">{c.key ? 'PK' : ''}</span>
          <span className="schema-name">{c.column}</span>
          <span className="schema-type">{c.type}{c.nullable ? '?' : ''}{c.maxLength ? `(${c.maxLength})` : ''}</span>
        </div>
      ))}
      {more > 0 && <div className="schema-more" style={{ height: SCHEMA_ROW }}>{more} more columns</div>}
      {schema.relations.length > 0 && (
        <div className="schema-rel" title={schema.relations.join(', ')}>
          {schema.relations.map(r => {
            const [kind, name] = r.split(' ')
            return <span key={r}><i>{kind === 'many' ? '∗' : '1'}</i>{name}</span>
          })}
        </div>
      )}
    </div>
  )
}

/** Monaco's colorizer gives one HTML fragment per line; cache by text so re-layouts are cheap. */
const colorCache = new Map<string, string[]>()
function useColorized(text: string, lang: string) {
  const [html, setHtml] = useState<string[] | null>(colorCache.get(text) ?? null)
  useEffect(() => {
    if (colorCache.has(text)) return setHtml(colorCache.get(text)!)
    let live = true
    monaco.editor.colorize(text, lang, { tabSize: 4 }).then(out => {
      const lines = out.replace(/^<div[^>]*>/, '').replace(/<\/div>$/, '').split('<br/>')
      colorCache.set(text, lines)
      if (live) setHtml(lines)
    })
    return () => {
      live = false
    }
  }, [text, lang])
  return html
}

/** Character offset of a click inside a (colorized) line, counting text across its spans. */
function clickOffset(src: HTMLElement, e: MouseEvent) {
  const doc = document as Document & { caretRangeFromPoint?(x: number, y: number): Range | null }
  const range = doc.caretRangeFromPoint?.(e.clientX, e.clientY)
  if (!range || !src.contains(range.startContainer)) return src.textContent?.length ?? 0
  let offset = 0
  const walker = document.createTreeWalker(src, NodeFilter.SHOW_TEXT)
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    if (n === range.startContainer) return offset + range.startOffset
    offset += n.textContent?.length ?? 0
  }
  return offset
}

export const CardNode = memo(({ data }: NodeProps<Node<CardData>>) => {
  const { node, lines, rows, full, compactable, calls, selected, touched, editing } = data
  const actions = useContext(ActionsCtx)
  const color = KIND_COLOR[node.kind]
  const html = useColorized(lines.map(l => l.text).join('\n'), langOf(node.file))
  const callByLine = new Map<number, typeof calls>()
  for (const c of calls) callByLine.set(c.edge.callLine, [...(callByLine.get(c.edge.callLine) ?? []), c])
  const hiddenCount = calls.filter(c => c.hidden).length
  const file = node.file?.split('/').pop()
  const schema = node.schema
  // A database card is named after its table; the entity and context go underneath.
  const { owner, member } = schema ? { owner: schema.dbSchemaName ?? '', member: schema.table } : splitLabel(node.label)
  const rawLines = node.code?.replace(/\t/g, '    ').replace(/\r/g, '').split('\n') ?? []
  const editable = !!(node.code && actions.edit)
  // Below this zoom the code is too small to aim at: the first click zooms in, the next one edits.
  const zoomedOut = useStore(st => st.transform[2] < 0.75)
  const changed = !!(touched || node.diff)

  // A press that moved is a pan, not a click: only a still click starts editing.
  const press = useRef<{ x: number; y: number } | null>(null)
  const onDown = (e: PointerEvent) => (press.current = { x: e.clientX, y: e.clientY })
  const still = (e: MouseEvent) => !press.current || Math.hypot(e.clientX - press.current.x, e.clientY - press.current.y) < 4

  const editAt = (e: MouseEvent, no: number) => {
    if (!editable || !still(e)) return
    if (zoomedOut && actions.focusLine) return actions.focusLine(node.key, no)
    const src = (e.currentTarget as HTMLElement).querySelector('.src') as HTMLElement | null
    const indent = (rawLines[no - node.startLine]?.length ?? 0) - (lines[no - node.startLine]?.text.length ?? 0)
    const col = src ? clickOffset(src, e) : 0
    actions.edit!(node.key, { line: no, column: indent + col + 1 })
  }

  return (
    <div
      className={`card kind-${node.kind}${selected ? ' selected' : ''}${changed ? ' changed' : ''}${editing ? ' editing' : ''}${editable ? (zoomedOut ? ' zoomable' : ' editable') : ''}`}
      style={{ '--k': color } as CSSProperties}
      onPointerDown={onDown}
    >
      <Handle type="target" position={Position.Left} id="in" style={{ top: HEADER_H / 2 }} />
      <div
        className="card-head"
        style={{ height: HEADER_H }}
        onClick={e => still(e) && (node.code || schema?.file) && actions.reveal?.(node.key)}
        onDoubleClick={() => (node.code || schema?.file) && actions.open(node.key)}
        title={node.code ? 'Click to show in the editor, double-click to open it' : schema?.file ? 'Click to show the entity, double-click to open it' : undefined}
      >
        <KindGlyph kind={node.kind} />
        <div className="titles">
          <div className="title">
            {owner && <span className="owner">{owner}.</span>}
            <span className="member">{member}</span>
          </div>
          <div className="sub">{schema ? `${schema.entity} in ${schema.context}` : node.kind === 'db' && /SaveChanges/.test(node.label) ? 'Saves tracked changes' : file ? `${file}:${node.startLine}` : node.sub}</div>
        </div>
        <div className="tools nodrag">
          {calls.length > 0 && (
            <button className="tool" title={hiddenCount ? `Show ${hiddenCount} hidden calls` : 'Hide all calls'} onClick={() => actions.toggleAll(node.key)}>
              {hiddenCount ? `+${hiddenCount}` : '−'}
            </button>
          )}
          {compactable && !node.diff && !editing && (
            <button className="tool" title={full ? 'Show only the flow lines' : 'Show every line'} onClick={() => actions.toggleFull(node.key)}>
              {full ? '⇤' : '⇥'}
            </button>
          )}
          {node.code && actions.mention && (
            <button className="tool" title="Mention this method in Claude Code (terminal)" onClick={() => actions.mention!(node.key)}>
              @
            </button>
          )}
          {node.code && (
            <button className="tool" title="Open in the editor" onClick={() => actions.open(node.key)}>
              ↗
            </button>
          )}
        </div>
      </div>

      {schema && <SchemaBody schema={schema} />}
      {editing && node.code && actions.save && (
        <CardEditor code={node.code} file={node.file} startLine={node.startLine} caret={actions.caret} onSave={t => actions.save!(node.key, t)} onCancel={() => actions.cancelEdit?.()} />
      )}

      {!editing && rows.length > 0 && (
        <div className="code" style={{ paddingTop: CODE_PAD, paddingBottom: CODE_PAD }}>
          {rows.map(r => {
            if ('del' in r)
              return (
                <div key={`d${r.after}-${r.i}`} className="ln del" style={{ height: LINE_H }}>
                  <span className="gutter" />
                  <span className="src">{r.del}</span>
                </div>
              )
            if (!('no' in r))
              return (
                <div key={`g${r.from}`} className="ln gap" style={{ height: LINE_H }} onClick={e => still(e) && actions.toggleFull(node.key)}>
                  <span className="gutter">⋯</span>
                  <span className="src">{r.gap} more lines</span>
                </div>
              )
            const l = r
            const lineCalls = callByLine.get(l.no)
            const i = l.no - node.startLine
            const callee = lineCalls?.[0].edge.node
            return (
              <div
                key={l.no}
                className={`ln${lineCalls ? ' call' : ''}${node.diff?.added.includes(l.no) ? ' add' : ''}`}
                style={{ height: LINE_H, ...(callee ? ({ '--c': KIND_COLOR[callee.kind] } as CSSProperties) : {}) }}
                onClick={e => editAt(e, l.no)}
                onMouseEnter={callee ? () => actions.trace?.(node.key, callee.key) : undefined}
                onMouseLeave={callee ? () => actions.trace?.(null) : undefined}
              >
                <span className="gutter">{l.no}</span>
                {html ? <span className="src" dangerouslySetInnerHTML={{ __html: html[i] ?? '' }} /> : <span className="src">{l.text}</span>}
                {lineCalls && callee && (
                  <button
                    className={`port nodrag${lineCalls.some(c => c.hidden) ? ' folded' : ''}`}
                    title={lineCalls.some(c => c.hidden) ? `Show ${callee.label}` : `Hide ${callee.label}`}
                    onClick={e => {
                      e.stopPropagation()
                      lineCalls.forEach(c => actions.toggle(c.edge.node.key))
                    }}
                  >
                    {splitLabel(callee.label).member}
                    {lineCalls.length > 1 && <span className="port-more">+{lineCalls.length - 1}</span>}
                  </button>
                )}
              </div>
            )
          })}
        </div>
      )}

      {node.diff && !editing && (
        <div className="review nodrag">
          <span className="review-what">Agent edit</span>
          <span className="review-stat">
            <b className="plus">+{node.diff.plus}</b>
            <b className="minus">−{node.diff.minus}</b>
          </span>
          {!!actions.editHooks?.length && (
            <span className="review-hooks" title={`Set to run after every agent edit:\n${actions.editHooks.join('\n')}`}>
              {actions.editHooks.length} {actions.editHooks.length === 1 ? 'hook' : 'hooks'}
            </span>
          )}
          <span className="review-space" />
          {actions.undo && (
            <button className="btn ghost" onClick={() => actions.undo!(node.key)}>
              Undo
            </button>
          )}
          {actions.keep && (
            <button className="btn solid" onClick={() => actions.keep!(node.key)}>
              Keep
            </button>
          )}
        </div>
      )}

      {calls.map(c => (
        <Handle key={c.edge.node.key} type="source" position={Position.Right} id={`h-${c.edge.node.key}`} style={{ top: c.y, opacity: c.hidden ? 0 : 1, ['--c' as string]: KIND_COLOR[c.edge.node.kind] }} />
      ))}
    </div>
  )
})

export const FrameNode = memo(({ data }: NodeProps<Node<FrameData>>) => <div className="frame" style={{ '--k': KIND_COLOR[data.kind] } as CSSProperties} />)

export const nodeTypes = { card: CardNode, frame: FrameNode }
