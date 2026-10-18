// The shell terminal of the demo: a prompt that takes a few real commands (ls, git status, git log, claude, clear) and says
// plainly when it does not know one. It is not a shell: nothing runs, and the demo is the only place it is ever used.
import type { Terminal } from '@xterm/xterm'
import { C } from './claudeTui'
import type { TermController } from './term'

export interface ShellHost {
  /** Whether the agent's change is in the files (the prompt and `git status` say so). */
  dirty(): boolean
  changedPaths(): string[]
  /** `claude` was typed: start the agent in a terminal of its own. */
  startClaude(): void
}

const files = ['CLAUDE.md', 'billing-service', 'orders-service', 'shipping-service']

export class ShellTui implements TermController {
  private term: Terminal | undefined
  private buffer = ''
  private history: string[] = []
  private at = -1
  /** What was written, so a terminal opened again shows the same screen. */
  private screen: string[] = []

  constructor(readonly id: string, private readonly host: ShellHost) {
    this.screen.push(this.prompt())
  }

  private prompt() {
    const mark = this.host.dirty() ? ` ${C.yellow}✗${C.reset}` : ''
    return `${C.green}➜${C.reset}  ${ESC_CYAN}harbor-goods${C.reset} ${C.blue}git:(${C.red}main${C.blue})${C.reset}${mark} `
  }

  private out(s: string) {
    this.screen.push(s)
    this.term?.write(s)
  }

  attach(term: Terminal) {
    this.term = term
    term.reset()
    term.write(this.screen.join(''))
  }
  detach() {
    this.term = undefined
  }
  resized() {}

  private run(line: string) {
    const [cmd, ...args] = line.trim().split(/\s+/)
    const text = (s: string) => `${s.replace(/\n/g, '\r\n')}\r\n`
    if (!cmd) return
    if (cmd === 'claude') return this.host.startClaude()
    if (cmd === 'clear') {
      this.screen = []
      this.term?.write('\x1b[2J\x1b[3J\x1b[H')
      return
    }
    if (cmd === 'ls') return this.out(text(files.map(f => (f.includes('.') ? f : `${C.blue}${f}${C.reset}`)).join('  ')))
    if (cmd === 'pwd') return this.out(text('/Users/demo/harbor-goods'))
    if (cmd === 'git' && args[0] === 'status') {
      const changed = this.host.changedPaths()
      if (!changed.length) return this.out(text('On branch main\nnothing to commit, working tree clean'))
      return this.out(text(`On branch main\nChanges not staged for commit:\n${changed.map(p => `\t${C.red}modified:   ${p}${C.reset}`).join('\n')}\n\nno changes added to commit`))
    }
    if (cmd === 'git' && args[0] === 'log') return this.out(text(`${C.yellow}a41c9e2${C.reset} (${C.blue}HEAD -> ${C.green}main${C.reset}) Orders, billing and shipping services`))
    if (cmd === 'help' || cmd === '?') return this.out(text('This terminal knows: claude, ls, pwd, git status, git log --oneline, clear.'))
    this.out(text(`zsh: command not found: ${cmd}`))
  }

  input(data: string) {
    if (data === '\r') {
      this.out('\r\n')
      const line = this.buffer
      this.buffer = ''
      this.at = -1
      if (line.trim()) this.history.push(line)
      this.run(line)
      this.out(this.prompt())
      return
    }
    if (data === '\x7f') {
      if (this.buffer) {
        this.buffer = this.buffer.slice(0, -1)
        this.term?.write('\b \b')
        this.screen.push('\b \b')
      }
      return
    }
    if (data === '\x1b[A' || data === '\x1b[B') {
      if (!this.history.length) return
      this.at = data === '\x1b[A' ? Math.min(this.history.length - 1, this.at + 1) : Math.max(-1, this.at - 1)
      const next = this.at < 0 ? '' : this.history[this.history.length - 1 - this.at]
      this.term?.write(`${'\b \b'.repeat(this.buffer.length)}${next}`)
      this.screen.push('\b \b'.repeat(this.buffer.length) + next)
      this.buffer = next
      return
    }
    if (data >= ' ' && data !== '\x7f' && !data.startsWith('\x1b')) {
      this.buffer += data
      this.out(data)
    }
  }
}

const ESC_CYAN = '\x1b[36m'
