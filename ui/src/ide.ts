// IDE-like help for the canvas: completion, signature help and hover in the card editor, and
// Ctrl/Cmd+click (or F12) to go to a definition. The webview has no language servers; every answer comes
// from the editor host (op `complete`, `signature`, `hover`, `definition`), which shows the card's current
// text to the real language servers first. Nothing here touches the file: the host does.
import * as monaco from 'monaco-editor'

export interface IdeBridge {
  request<T>(op: string, payload: Record<string, unknown>): Promise<T>
}

/** The card an editor was opened on. `session` is one id per opening: the host ignores answers for closed ones. */
export interface EditCtx {
  session: string
  key: string
  file: string
  startLine: number
  endLine: number
  /** The card's text as it was drawn (the file's lines startLine..endLine). */
  original: string
  /** The host has been asked something, so it has to be told when the editor closes. */
  used?: boolean
}

/** A short message on the canvas bar (set by the canvas; clears itself). */
export const notify = { show: (_message: string) => {} }

let bridge: IdeBridge | undefined
/** Editors that are open, by their model: providers find the card an editor belongs to from the model they are asked about. */
const open = new Map<string, EditCtx>()

const TRIGGERS = ['.', ':', '(', '<', '"', "'", '/', '@']

// Monaco's kind numbers differ from VS Code's; the host sends VS Code's.
const K = monaco.languages.CompletionItemKind
const KIND: monaco.languages.CompletionItemKind[] = [
  K.Text, K.Method, K.Function, K.Constructor, K.Field, K.Variable, K.Class, K.Interface, K.Module, K.Property, K.Unit, K.Value, K.Enum, K.Keyword, K.Snippet, K.Color, K.File, K.Reference, K.Folder, K.EnumMember, K.Constant, K.Struct, K.Event, K.Operator, K.TypeParameter,
]

interface WireRange {
  startLineNumber: number
  startColumn: number
  endLineNumber: number
  endColumn: number
}
interface WireDoc {
  value: string
  markdown: boolean
}
interface WireItem {
  label: string
  labelDetail?: string
  labelDescription?: string
  kind: number
  tags?: number[]
  detail?: string
  documentation?: WireDoc
  sortText?: string
  filterText?: string
  preselect?: boolean
  insertText: string
  snippet: boolean
  keepWhitespace?: boolean
  insert?: WireRange
  replace?: WireRange
  commitCharacters?: string[]
  edits?: { range: WireRange; text: string }[]
  needsImport?: boolean
}
interface WireCompletions {
  items: WireItem[]
  incomplete?: boolean
  message?: string
  stale?: boolean
}
interface WireSignatureHelp {
  activeSignature?: number
  activeParameter?: number
  signatures: { label: string; documentation?: WireDoc; activeParameter?: number; parameters: { label: string | [number, number]; documentation?: WireDoc }[] }[]
}
export interface DefinitionResult {
  ok: boolean
  message?: string
  /** The definition is inside the card being edited: where to put the cursor. */
  local?: { lineNumber: number; column: number }
}

const doc = (d?: WireDoc): string | monaco.IMarkdownString | undefined => (d ? (d.markdown ? { value: d.value } : d.value) : undefined)

/** What every question about the card carries: which card, its text now, and where the cursor is. */
function query(c: EditCtx, model: monaco.editor.ITextModel, at: monaco.IPosition) {
  c.used = true
  return { session: c.session, key: c.key, file: c.file, startLine: c.startLine, endLine: c.endLine, original: c.original, text: model.getValue(), line: at.lineNumber, column: at.column }
}

/** Identifiers in the card: the floor under every answer, so a popup is never empty just because a server has nothing. */
function wordsIn(model: monaco.editor.ITextModel, except: string, range: monaco.IRange, skip: Set<string>): monaco.languages.CompletionItem[] {
  const seen = new Set<string>()
  const out: monaco.languages.CompletionItem[] = []
  for (const m of model.getValue().matchAll(/[\p{L}_$][\p{L}\p{N}_$]*/gu)) {
    if (m[0] === except || seen.has(m[0]) || skip.has(m[0]) || m[0].length < 2) continue
    seen.add(m[0])
    // Behind everything a server sends: those sort texts start with a letter or a digit.
    out.push({ label: m[0], kind: K.Text, insertText: m[0], range, sortText: `~${m[0]}` })
    if (out.length >= 300) break
  }
  return out
}

/** The words each language reserves: Monaco's tokenizers know them but do not offer them. */
const KEYWORDS: Record<string, string> = {
  csharp: 'abstract as async await base bool break byte case catch char checked class const continue decimal default delegate do double else enum event explicit extern false finally fixed float for foreach goto if implicit in int interface internal is lock long namespace new null object operator out override params private protected public readonly ref return sbyte sealed short sizeof static string struct switch this throw true try typeof uint ulong unchecked unsafe ushort using var virtual void volatile while yield record init required',
  java: 'abstract assert boolean break byte case catch char class const continue default do double else enum extends final finally float for if implements import instanceof int interface long native new null package private protected public return short static strictfp super switch synchronized this throw throws transient true false try var void volatile while record',
  python: 'False None True and as assert async await break class continue def del elif else except finally for from global if import in is lambda nonlocal not or pass raise return try while with yield self',
  go: 'break case chan const continue default defer else fallthrough for func go goto if import interface map package range return select struct switch type var nil true false',
  rust: 'as async await break const continue crate dyn else enum extern false fn for if impl in let loop match mod move mut pub ref return self Self static struct super trait true type unsafe use where while',
  ruby: 'alias and begin break case class def do else elsif end ensure false for if in module next nil not or redo rescue retry return self super then true undef unless until when while yield',
  php: 'abstract and array as break case catch class clone const continue declare default do echo else elseif empty enum extends final finally fn for foreach function global if implements include instanceof interface isset list namespace new null or print private protected public readonly require return static switch this throw trait true false try unset use var while yield',
  typescript: 'abstract any as async await boolean break case catch class const continue debugger declare default delete do else enum export extends false finally for from function if implements import in instanceof interface is keyof let module namespace never new null number of private protected public readonly return static string super switch this throw true try type typeof undefined unknown var void while yield',
  javascript: 'async await break case catch class const continue debugger default delete do else export extends false finally for from function if import in instanceof let new null of return static super switch this throw true try typeof undefined var void while yield',
}

function keywordsFor(lang: string, range: monaco.IRange, skip: Set<string>): monaco.languages.CompletionItem[] {
  return (KEYWORDS[lang]?.split(' ') ?? []).filter(k => !skip.has(k)).map(k => ({ label: k, kind: K.Keyword, insertText: k, range, sortText: `~~${k}` }))
}

/** Say a thing from the host once in a while, not on every keystroke that gets the same answer. */
let lastNote = { message: '', at: 0 }
function noteOnce(message: string) {
  const now = Date.now()
  if (message === lastNote.message && now - lastNote.at < 15_000) return
  lastNote = { message, at: now }
  notify.show(message)
}

/**
 * How long a popup waits for the host before it shows what it has (words) and asks again as the user types. After a host that was
 * late, the next questions wait only briefly for a while: one slow answer must not make every key slow.
 */
const HOST_WAIT_MS = 1500
const HOST_WAIT_AFTER_LATE_MS = 400
let slowUntil = 0

const inLine = (r: WireRange | undefined, p: monaco.Position) => !!r && r.startLineNumber === p.lineNumber && r.endLineNumber === p.lineNumber && r.startColumn <= p.column && p.column <= r.endColumn

function provideCompletions(b: IdeBridge) {
  return async (model: monaco.editor.ITextModel, position: monaco.Position, context: monaco.languages.CompletionContext): Promise<monaco.languages.CompletionList | undefined> => {
    const c = open.get(model.uri.toString())
    if (!c) return undefined
    const word = model.getWordUntilPosition(position)
    const fallback: monaco.IRange = { startLineNumber: position.lineNumber, endLineNumber: position.lineNumber, startColumn: word.startColumn, endColumn: word.endColumn }
    const ask = b.request<WireCompletions>('complete', { ...query(c, model, position), trigger: context.triggerCharacter }).catch((e): WireCompletions => ({ items: [], message: String((e as Error).message ?? e) }))
    // A host that is slow (the analyzer starting, a language server indexing) must not leave the popup on "Loading...".
    let timer: ReturnType<typeof setTimeout> | undefined
    const late = new Promise<null>(resolve => {
      timer = setTimeout(() => resolve(null), Date.now() < slowUntil ? HOST_WAIT_AFTER_LATE_MS : HOST_WAIT_MS)
    })
    const answered = await Promise.race([ask, late])
    clearTimeout(timer)
    if (answered === null) slowUntil = Date.now() + 15_000
    const res: WireCompletions = answered ?? { items: [], message: 'The editor is slow to answer: showing words of the card.' }
    // The card was closed, or the cursor moved on: nothing to show.
    if (open.get(model.uri.toString()) !== c || model.isDisposed() || res.stale) return undefined
    if (res.message) noteOnce(res.message)
    const suggestions = res.items.map((w): monaco.languages.CompletionItem => {
      const both = inLine(w.insert, position) && inLine(w.replace, position)
      return {
        label: w.labelDetail || w.labelDescription ? { label: w.label, detail: w.labelDetail ?? undefined, description: w.labelDescription ?? undefined } : w.label,
        kind: KIND[w.kind] ?? K.Text,
        tags: w.tags?.includes(1) ? [monaco.languages.CompletionItemTag.Deprecated] : undefined,
        detail: w.needsImport ? `${w.detail ?? ''} (import not added)`.trim() : (w.detail ?? undefined),
        documentation: doc(w.documentation ?? undefined),
        sortText: w.sortText ?? undefined,
        filterText: w.filterText ?? undefined,
        preselect: w.preselect ?? undefined,
        insertText: w.insertText,
        insertTextRules: (w.snippet ? monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet : 0) | (w.keepWhitespace ? monaco.languages.CompletionItemInsertTextRule.KeepWhitespace : 0) || undefined,
        range: both ? { insert: w.insert!, replace: w.replace! } : fallback,
        commitCharacters: w.commitCharacters ?? undefined,
        additionalTextEdits: w.edits?.map(e => ({ range: e.range, text: e.text })),
      }
    })
    // The floor: words of the card (and the language's keywords) next to what the host sent, never twice. After a trigger character
    // (`a.`) the host's members are the answer; words only stand in when it sent none.
    if (!context.triggerCharacter || !suggestions.length) {
      const have = new Set(res.items.map(i => i.label))
      suggestions.push(...wordsIn(model, word.word, fallback, have))
      if (!context.triggerCharacter) suggestions.push(...keywordsFor(model.getLanguageId(), fallback, have))
    }
    // An answer that came late, or in part, is asked for again as the word grows.
    return { suggestions, incomplete: res.incomplete || answered === null }
  }
}

function provideSignature(b: IdeBridge) {
  return async (model: monaco.editor.ITextModel, position: monaco.Position, _token: monaco.CancellationToken, context: monaco.languages.SignatureHelpContext): Promise<monaco.languages.SignatureHelpResult | undefined> => {
    const c = open.get(model.uri.toString())
    if (!c) return undefined
    const help = await b.request<WireSignatureHelp | null>('signature', { ...query(c, model, position), trigger: context.triggerCharacter }).catch(() => null)
    if (!help || open.get(model.uri.toString()) !== c || model.isDisposed()) return undefined
    return {
      value: {
        activeSignature: help.activeSignature ?? 0,
        activeParameter: help.activeParameter ?? 0,
        signatures: help.signatures.map(s => ({ label: s.label, documentation: doc(s.documentation), activeParameter: s.activeParameter, parameters: s.parameters.map(p => ({ label: p.label, documentation: doc(p.documentation) })) })),
      },
      dispose() {},
    }
  }
}

function provideHover(b: IdeBridge) {
  return async (model: monaco.editor.ITextModel, position: monaco.Position): Promise<monaco.languages.Hover | undefined> => {
    const c = open.get(model.uri.toString())
    if (!c) return undefined
    const h = await b.request<{ contents: string[]; range?: WireRange } | null>('hover', query(c, model, position)).catch(() => null)
    if (!h || open.get(model.uri.toString()) !== c || model.isDisposed()) return undefined
    return { contents: h.contents.map(value => ({ value })), range: h.range }
  }
}

let registered = false
/** Once, for the languages the cards can show: the providers work for any editor that `bindEditor` has been called for. */
export function registerIde(languages: string[], b: IdeBridge) {
  bridge = b
  if (registered) return
  registered = true
  // Monaco's own TypeScript/JavaScript service has no project (and no worker here): the host's language servers answer instead.
  const off = { completionItems: false, hovers: false, documentSymbols: false, definitions: false, references: false, documentHighlights: false, rename: false, diagnostics: false, documentRangeFormattingEdits: false, signatureHelp: false, onTypeFormattingEdits: false, codeActions: false, inlayHints: false }
  monaco.typescript.typescriptDefaults.setModeConfiguration(off)
  monaco.typescript.javascriptDefaults.setModeConfiguration(off)
  for (const lang of new Set(languages)) {
    monaco.languages.registerCompletionItemProvider(lang, { triggerCharacters: TRIGGERS, provideCompletionItems: provideCompletions(b) })
    monaco.languages.registerSignatureHelpProvider(lang, { signatureHelpTriggerCharacters: ['(', ','], signatureHelpRetriggerCharacters: [')'], provideSignatureHelp: provideSignature(b) })
    monaco.languages.registerHoverProvider(lang, { provideHover: provideHover(b) })
  }
}

// ---- go to definition ---------------------------------------------------------------------------

/** Ask the host for the definition of the symbol at a file position (a card that is only read). */
export async function definitionInFile(file: string, line: number, column: number) {
  if (!bridge) return
  try {
    const res = await bridge.request<DefinitionResult>('definition', { file, line, column })
    if (!res.ok && res.message) notify.show(res.message)
  } catch (e) {
    notify.show(String((e as Error).message ?? e))
  }
}

const WORD = /[\p{L}\p{N}_$]/u
const isIdent = (w: string) => /^[\p{L}_$]/u.test(w)

/** The identifier at a point of the page, as a DOM range, when the pointer really is on it. Works on any text inside `root`. */
export function wordAtPoint(root: HTMLElement, x: number, y: number): { range: Range; node: Text; start: number } | null {
  const doc = document as Document & { caretRangeFromPoint?(x: number, y: number): Range | null }
  const caret = doc.caretRangeFromPoint?.(x, y)
  const node = caret?.startContainer
  if (!caret || !node || node.nodeType !== Node.TEXT_NODE || !root.contains(node)) return null
  const text = node.textContent ?? ''
  let a = caret.startOffset
  let b = a
  while (a > 0 && WORD.test(text[a - 1])) a--
  while (b < text.length && WORD.test(text[b])) b++
  if (a === b || !isIdent(text.slice(a, b))) return null
  const range = document.createRange()
  range.setStart(node, a)
  range.setEnd(node, b)
  // The nearest caret is not enough: the pointer has to be on the word itself.
  const box = range.getBoundingClientRect()
  if (x < box.left - 1 || x > box.right + 1 || y < box.top || y > box.bottom) return null
  return { range, node: node as Text, start: a }
}

// Cards that are only read: Ctrl/Cmd held over an identifier underlines it and shows a pointer (CSS Custom Highlight API where there is one).
interface Highlights {
  set(name: string, h: unknown): void
  delete(name: string): void
}
const highlights = (): Highlights | undefined => (typeof CSS !== 'undefined' ? (CSS as unknown as { highlights?: Highlights }).highlights : undefined)
let linked: HTMLElement | undefined
let lastMove: { root: HTMLElement; e: { clientX: number; clientY: number } } | undefined

function unlink() {
  highlights()?.delete('flow-link')
  if (linked) linked.style.cursor = ''
  linked = undefined
}

function link(root: HTMLElement, x: number, y: number) {
  const hit = wordAtPoint(root, x, y)
  if (!hit) return unlink()
  const H = (globalThis as unknown as { Highlight?: new (...r: Range[]) => unknown }).Highlight
  if (linked && linked !== root) unlink()
  root.style.cursor = 'pointer'
  linked = root
  if (H) highlights()?.set('flow-link', new H(hit.range))
}

/** Mouse moved over a card's code: show what Ctrl/Cmd+click would go to. `root` is the line's text element. */
export function hoverCode(root: HTMLElement | null, e: { clientX: number; clientY: number; ctrlKey: boolean; metaKey: boolean }) {
  lastMove = root ? { root, e: { clientX: e.clientX, clientY: e.clientY } } : undefined
  if (root && (e.ctrlKey || e.metaKey)) link(root, e.clientX, e.clientY)
  else if (linked) unlink()
}
export function leaveCode() {
  lastMove = undefined
  unlink()
}

addEventListener('keydown', e => {
  if ((e.key === 'Control' || e.key === 'Meta') && lastMove) link(lastMove.root, lastMove.e.clientX, lastMove.e.clientY)
}, true)
addEventListener('keyup', e => {
  if (!e.ctrlKey && !e.metaKey) unlink()
}, true)
addEventListener('blur', unlink)

// ---- the card editor ----------------------------------------------------------------------------

/**
 * Wire an editor on a card to the host: its model answers to the providers above, F12 and Ctrl/Cmd+click go to the
 * definition, and Ctrl/Cmd held underlines the identifier under the mouse. Returns what to call when the editor goes away:
 * it tells the host, which puts the card's original text back in the document unless it was saved.
 */
export function bindEditor(ed: monaco.editor.IStandaloneCodeEditor, ctx: EditCtx): () => void {
  const model = ed.getModel()!
  const uri = model.uri.toString()
  open.set(uri, ctx)
  const links = ed.createDecorationsCollection()
  let at: monaco.IPosition | null = null

  const gotoDefinition = async (pos: monaco.IPosition) => {
    if (!bridge) return
    const word = model.getWordAtPosition(pos)
    try {
      const res = await bridge.request<DefinitionResult>('definition', query(ctx, model, { lineNumber: pos.lineNumber, column: word?.startColumn ?? pos.column }))
      if (open.get(uri) !== ctx) return
      if (res.local) {
        ed.setPosition(res.local)
        ed.revealPositionInCenterIfOutsideViewport(res.local)
        ed.focus()
      } else if (!res.ok && res.message) notify.show(res.message)
    } catch (e) {
      notify.show(String((e as Error).message ?? e))
    }
  }

  const paint = (ctrl: boolean) => {
    const word = ctrl && at ? model.getWordAtPosition(at) : null
    links.set(word && at && isIdent(word.word) ? [{ range: new monaco.Range(at.lineNumber, word.startColumn, at.lineNumber, word.endColumn), options: { inlineClassName: 'flow-link' } }] : [])
  }

  const subs = [
    ed.onMouseMove(e => {
      at = e.target.type === monaco.editor.MouseTargetType.CONTENT_TEXT ? e.target.position : null
      paint(e.event.ctrlKey || e.event.metaKey)
    }),
    ed.onMouseLeave(() => {
      at = null
      paint(false)
    }),
    ed.onKeyDown(e => (e.ctrlKey || e.metaKey) && paint(true)),
    ed.onKeyUp(e => !e.ctrlKey && !e.metaKey && paint(false)),
    ed.onMouseDown(e => {
      if (!(e.event.ctrlKey || e.event.metaKey) || !e.event.leftButton || e.target.type !== monaco.editor.MouseTargetType.CONTENT_TEXT || !e.target.position) return
      e.event.preventDefault()
      void gotoDefinition(e.target.position)
    }),
  ]
  ed.addCommand(monaco.KeyCode.F12, () => {
    const p = ed.getPosition()
    if (p) void gotoDefinition(p)
  })

  return () => {
    subs.forEach(s => s.dispose())
    links.clear()
    if (open.get(uri) === ctx) open.delete(uri)
    if (ctx.used) void bridge?.request('endEdit', { session: ctx.session }).catch(() => {})
  }
}
