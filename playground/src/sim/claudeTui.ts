// The screen of a Claude Code session in a terminal: the output scrolls in the top of the window, and the prompt box (or a
// permission question) stays at the bottom, the way the real terminal UI is laid out. Drawn with escape sequences into xterm.js.
// The words are a scripted replay (scenario.ts); this file only knows how to draw them.
import type { Terminal } from '@xterm/xterm'
import type { AgentEdit } from '../demo'
import type { TermController } from './term'

const ESC = '\x1b'
export const C = {
  reset: `${ESC}[0m`,
  bold: `${ESC}[1m`,
  dim: `${ESC}[38;5;245m`,
  faint: `${ESC}[38;5;240m`,
  white: `${ESC}[97m`,
  orange: `${ESC}[38;2;215;119;87m`,
  green: `${ESC}[38;2;95;224;161m`,
  red: `${ESC}[38;2;255;107;125m`,
  blue: `${ESC}[38;2;143;166;255m`,
  yellow: `${ESC}[38;2;255;180;84m`,
  bgAdd: `${ESC}[48;2;16;52;36m`,
  bgDel: `${ESC}[48;2;66;22;30m`,
}

/** Inline code in a message (between backticks) is drawn in a colour of its own, without the backticks, as the terminal UI does. */
const code = (s: string) => s.replace(/`([^`]+)`/g, (_, x: string) => `${C.blue}${x}${C.white}`)

/** The text without its colour codes: what takes room in a row. */
const plain = (s: string) => s.replace(/\u001b\[[0-9;]*m/g, '')
const width = (s: string) => [...plain(s)].length
const padTo = (s: string, w: number) => s + ' '.repeat(Math.max(0, w - width(s)))
/** Cuts a coloured line to `w` columns, keeping the codes it passes. */
function clip(s: string, w: number): string {
  if (width(s) <= w) return s
  let out = ''
  let seen = 0
  const parts = s.split(/(\u001b\[[0-9;]*m)/)
  for (const p of parts) {
    if (/^\u001b\[/.test(p)) out += p
    else {
      const chars = [...p]
      const room = w - 1 - seen
      out += chars.slice(0, Math.max(0, room)).join('')
      seen += Math.min(chars.length, Math.max(0, room))
      if (chars.length > room) return `${out}…${C.reset}`
    }
  }
  return out
}
/** Plain text broken into lines of at most `w` columns, on spaces. */
function wrap(text: string, w: number): string[] {
  const lines: string[] = []
  for (const para of text.split('\n')) {
    let line = ''
    for (const word of para.split(' ')) {
      if (line && width(`${line} ${word}`) > w) {
        lines.push(line)
        line = word
      } else line = line ? `${line} ${word}` : word
    }
    lines.push(line)
  }
  return lines
}

export type Footer =
  | { kind: 'prompt'; text: string; placeholder?: string; hint: string; spinner?: string }
  | { kind: 'dialog'; title: string; file: string; diff: string[]; question: string; options: string[]; selected: number }

/** One thing printed above the prompt: either lines of a known shape (`raw`) or text that wraps to the window (`wrap`). */
type Entry = { raw: string } | { wrap: string; indent: string; first: string }

export class ClaudeTui implements TermController {
  private entries: Entry[] = []
  private term: Terminal | undefined
  private footer: Footer = { kind: 'prompt', text: '', placeholder: '', hint: '? for shortcuts' }
  private used = 0
  /** Where a key goes while the session waits for one (the permission question), or the Enter that sends the typed prompt. */
  onKey: ((key: 'up' | 'down' | 'enter' | 'escape' | '1' | '2' | '3') => void) | undefined

  constructor(readonly id: string, private readonly cwd: string) {}

  // ---- what the scenario does ------------------------------------------------------------------------------------------

  /** A line of output, already coloured. */
  line(raw = '') {
    this.add({ raw })
  }

  /** The assistant's words: a white bullet, then text that wraps with a hanging indent. */
  say(text: string) {
    this.add({ wrap: code(text), indent: '  ', first: `${C.white}⏺${C.reset} ` })
    this.line()
  }

  /** More of the assistant's text, under its message: wrapped with the same indent, inline code coloured. */
  para(text: string) {
    this.add({ wrap: code(text), indent: '  ', first: '  ' })
  }

  /** A tool call and what came back: `⏺ Read(path)`, then `⎿ Read 38 lines`. */
  tool(name: string, arg: string, result?: string[], ok = true) {
    this.line(`${ok ? C.green : C.red}⏺${C.reset} ${C.bold}${name}${C.reset}${C.dim}(${arg})${C.reset}`)
    result?.forEach((r, i) => this.line(`${C.dim}${i === 0 ? '  ⎿  ' : '     '}${r}${C.reset}`))
    this.line()
  }

  /** An edit as the terminal shows it once it is made: the counts, then the changed lines with their numbers. */
  edited(edit: AgentEdit) {
    const name = edit.path
    this.line(`${C.green}⏺${C.reset} ${C.bold}Update${C.reset}${C.dim}(${name})${C.reset}`)
    this.line(`${C.dim}  ⎿  Updated ${C.reset}${C.bold}${name}${C.reset}${C.dim} with ${edit.plus} addition${edit.plus === 1 ? '' : 's'} and ${edit.minus} removal${edit.minus === 1 ? '' : 's'}${C.reset}`)
    for (const l of this.diffLines(edit)) this.line(`     ${l}`)
    this.line()
  }

  /** The hunks with line numbers: removed lines on red, added lines on green, context dim. */
  diffLines(edit: AgentEdit): string[] {
    const out: string[] = []
    for (const h of edit.hunks) {
      let oldN = h.oldStart
      let newN = h.newStart
      for (const l of h.lines) {
        const sign = l[0]
        const text = l.slice(1)
        if (sign === '-') out.push(`${C.bgDel}${C.red}${String(oldN++).padStart(4)} - ${text}${C.reset}`)
        else if (sign === '+') out.push(`${C.bgAdd}${C.green}${String(newN++).padStart(4)} + ${text}${C.reset}`)
        else {
          out.push(`${C.dim}${String(newN).padStart(4)}   ${text}${C.reset}`)
          oldN++
          newN++
        }
      }
    }
    return out
  }

  header(model: string) {
    this.line(`${C.orange} ▐▛███▜▌${C.reset}   ${C.bold}Claude Code${C.reset} ${C.dim}v2.1.302${C.reset}`)
    this.line(`${C.orange}▝▜█████▛▘${C.reset}  ${C.dim}${model} · Claude Max${C.reset}`)
    this.line(`${C.orange}  ▘▘ ▝▝${C.reset}    ${C.dim}${this.cwd}${C.reset}`)
    this.line()
  }

  setFooter(f: Footer) {
    this.footer = f
    this.paintFooter()
  }

  // ---- drawing -----------------------------------------------------------------------------------------------------------

  private cols = () => this.term?.cols ?? 100
  private rows = () => this.term?.rows ?? 24

  private footerLines(): string[] {
    const w = Math.max(20, this.cols() - 2)
    const f = this.footer
    const box = (inner: string[]) => [`${C.dim}╭${'─'.repeat(w - 2)}╮${C.reset}`, ...inner.map(l => `${C.dim}│${C.reset} ${padTo(clip(l, w - 4), w - 4)} ${C.dim}│${C.reset}`), `${C.dim}╰${'─'.repeat(w - 2)}╯${C.reset}`]
    if (f.kind === 'prompt') {
      const text = f.text ? `${C.white}${f.text}${C.reset}` : `${C.dim}${f.placeholder ?? ''}${C.reset}`
      const lines = wrap(f.text || f.placeholder || '', w - 8)
      const shown = f.text ? lines.map((l, i) => `${C.white}${i === 0 ? '> ' : '  '}${l}${C.reset}`) : [`${C.white}> ${C.reset}${text}`]
      return [...(f.spinner ? [`${C.orange}${f.spinner}${C.reset}`, ''] : []), ...box(shown), ` ${C.dim}${f.hint}${C.reset}`]
    }
    const inner = w - 4
    // Only as many changed lines as the window has room for: the question and its three answers must stay on screen.
    const room = Math.max(3, this.rows() - 12)
    const shown = f.diff.length > room ? [...f.diff.slice(0, room - 1), `${C.dim}     … ${f.diff.length - room + 1} more lines${C.reset}`] : f.diff
    const diff = shown.map(l => clip(l, inner - 4))
    const dialog = [
      `${C.bold}${f.title}${C.reset}`,
      `${C.dim}╭${'─'.repeat(inner - 2)}╮${C.reset}`,
      `${C.dim}│${C.reset} ${C.bold}${clip(f.file, inner - 4)}${C.reset}${' '.repeat(Math.max(0, inner - 4 - width(clip(f.file, inner - 4))))} ${C.dim}│${C.reset}`,
      ...diff.map(l => `${C.dim}│${C.reset} ${padTo(l, inner - 4)} ${C.dim}│${C.reset}`),
      `${C.dim}╰${'─'.repeat(inner - 2)}╯${C.reset}`,
      f.question,
      ...f.options.map((o, i) => (i === f.selected ? `${C.blue}❯ ${i + 1}. ${o}${C.reset}` : `  ${C.dim}${i + 1}. ${o}${C.reset}`)),
    ]
    return box(dialog)
  }

  private region = 0

  /** Redraws the bottom of the window and puts the scrolling region above it. */
  private paintFooter() {
    const t = this.term
    if (!t) return
    const lines = this.footerLines()
    const rows = this.rows()
    const next = Math.max(4, rows - lines.length)
    // The footer grew over lines already printed: scroll them up first, while the old region is still the one that scrolls.
    if (this.used > next && this.region > 0) {
      t.write(`${ESC}[${this.region};1H${'\n'.repeat(this.used - next)}`)
      this.used = next
    }
    const old = this.region
    this.region = next
    let out = `${ESC}[?25l${ESC}[1;${next}r`
    // The footer shrank: the rows it leaves belong to the output now, and must not keep its old lines.
    if (old > 0 && next > old) for (let r = old + 1; r <= next; r++) out += `${ESC}[${r};1H${ESC}[2K`
    out += `${ESC}[${next + 1};1H${ESC}[J`
    lines.forEach((l, i) => {
      if (next + 1 + i <= rows) out += `${ESC}[${next + 1 + i};1H${ESC}[2K${l}`
    })
    const f = this.footer
    if (f.kind === 'prompt') {
      const at = next + 1 + (f.spinner ? 2 : 0) + 1
      const inputLines = wrap(f.text, Math.max(20, this.cols() - 2) - 8)
      const row = at + Math.max(0, inputLines.length - 1)
      const col = 4 + width(inputLines.at(-1) ?? '')
      out += `${ESC}[${row};${col}H${ESC}[?25h`
    }
    t.write(out)
  }

  private add(e: Entry) {
    this.entries.push(e)
    const t = this.term
    if (t) this.draw(this.render(e), t)
  }

  private render(e: Entry): string[] {
    const w = Math.max(20, this.cols() - 1)
    if ('raw' in e) return [clip(e.raw, w)]
    return wrap(e.wrap, w - 2).map((l, i) => `${i === 0 ? e.first : e.indent}${C.white}${l}${C.reset}`)
  }

  /** Prints lines at the bottom of the scrolling region, scrolling what is there up. */
  private draw(lines: string[], t: Terminal) {
    if (!this.region) this.region = Math.max(4, this.rows() - this.footerLines().length)
    let out = `${ESC}[?25l`
    for (const l of lines) {
      if (this.used < this.region) {
        out += `${ESC}[${this.used + 1};1H${ESC}[2K${l}`
        this.used++
      } else out += `${ESC}[${this.region};1H\n${ESC}[2K${l}`
    }
    t.write(out)
    this.restoreCursor()
  }

  private restoreCursor() {
    const t = this.term
    if (!t) return
    const f = this.footer
    if (f.kind !== 'prompt') return
    const lines = this.footerLines()
    const at = this.rows() - lines.length + 1 + (f.spinner ? 2 : 0) + 1
    const inputLines = wrap(f.text, Math.max(20, this.cols() - 2) - 8)
    t.write(`${ESC}[${at + Math.max(0, inputLines.length - 1)};${4 + width(inputLines.at(-1) ?? '')}H${ESC}[?25h`)
  }

  // ---- the xterm binding ---------------------------------------------------------------------------------------------------

  attach(term: Terminal) {
    this.term = term
    this.redraw()
  }
  detach() {
    this.term = undefined
  }
  resized() {
    this.redraw()
  }
  private redraw() {
    const t = this.term
    if (!t) return
    t.reset()
    this.used = 0
    this.region = 0
    this.paintFooter()
    for (const e of this.entries) this.draw(this.render(e), t)
    this.restoreCursor()
  }

  input(data: string) {
    const key = data === '\r' ? 'enter' : data === '\x1b' ? 'escape' : data === '\x1b[A' ? 'up' : data === '\x1b[B' ? 'down' : data === '1' || data === '2' || data === '3' ? data : undefined
    if (key) this.onKey?.(key)
  }
}
