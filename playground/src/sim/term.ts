// Terminals of the workbench: xterm.js (the terminal VS Code itself uses) bound to a controller that decides what the terminal
// shows and what a key does. A controller keeps its own output, so a terminal tab that is closed and opened again shows it all.
import { FitAddon } from '@xterm/addon-fit'
import { Terminal } from '@xterm/xterm'
import '@xterm/xterm/css/xterm.css'

export interface TermController {
  readonly id: string
  /** An xterm now shows this controller: draw everything again, and listen. */
  attach(term: Terminal): void
  detach(): void
  /** The terminal got another size. */
  resized(term: Terminal): void
  /** Keys, as xterm reports them. */
  input(data: string): void
}

const controllers = new Map<string, TermController>()
export const registerTerminal = (c: TermController) => void controllers.set(c.id, c)
export const unregisterTerminal = (id: string) => void controllers.delete(id)
export const terminalController = (id: string) => controllers.get(id)

const cssVar = (name: string, fallback: string) => getComputedStyle(document.documentElement).getPropertyValue(`--vscode-${name}`).trim() || fallback

/** An xterm in `host` with the theme of the workbench's terminal, bound to the controller; returns what removes it again. */
export function mountTerminal(host: HTMLElement, controller: TermController): () => void {
  const term = new Terminal({
    fontFamily: 'ui-monospace, "Cascadia Code", Menlo, Consolas, monospace',
    fontSize: 13,
    lineHeight: 1.2,
    cursorBlink: true,
    cursorStyle: 'block',
    scrollback: 3000,
    allowProposedApi: true,
    theme: {
      background: cssVar('terminal-background', '#0c0c0c'),
      foreground: cssVar('terminal-foreground', '#e0e0e0'),
      cursor: cssVar('terminal-cursorForeground', '#e0e0e0'),
      selectionBackground: '#6f86ff40',
      black: cssVar('terminal-ansiBlack', '#232323'),
      red: cssVar('terminal-ansiRed', '#ff6b7d'),
      green: cssVar('terminal-ansiGreen', '#5fe0a1'),
      yellow: cssVar('terminal-ansiYellow', '#ffb454'),
      blue: cssVar('terminal-ansiBlue', '#6f86ff'),
      magenta: cssVar('terminal-ansiMagenta', '#b88cff'),
      cyan: cssVar('terminal-ansiCyan', '#4fd6d0'),
      white: cssVar('terminal-ansiWhite', '#e0e0e0'),
      brightBlack: cssVar('terminal-ansiBrightBlack', '#585858'),
      brightRed: cssVar('terminal-ansiBrightRed', '#ff94a2'),
      brightGreen: cssVar('terminal-ansiBrightGreen', '#8cf0be'),
      brightYellow: cssVar('terminal-ansiBrightYellow', '#ffd08a'),
      brightBlue: cssVar('terminal-ansiBrightBlue', '#a8b6ff'),
      brightMagenta: cssVar('terminal-ansiBrightMagenta', '#cfb0ff'),
      brightCyan: cssVar('terminal-ansiBrightCyan', '#86e8e4'),
      brightWhite: cssVar('terminal-ansiBrightWhite', '#fafafa'),
    },
  })
  const fit = new FitAddon()
  term.loadAddon(fit)
  term.open(host)
  const refit = () => {
    try {
      fit.fit()
    } catch {
      // the host has no size yet (a hidden tab): the next resize fits it
    }
    controller.resized(term)
  }
  const data = term.onData(d => controller.input(d))
  const observer = new ResizeObserver(() => refit())
  observer.observe(host)
  refit()
  controller.attach(term)
  return () => {
    observer.disconnect()
    data.dispose()
    controller.detach()
    term.dispose()
  }
}
