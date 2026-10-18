// The playground page: loads the demo data, starts the workbench (the Axle window on a Mac screen) and the guide under it.
import { createRoot } from 'react-dom/client'
import '@vscode/codicons/dist/codicon.css'
import './theme/vscode-theme.css'
import './workbench/workbench.css'
import './style.css'
import type { DemoData } from './demo'
import { Guide } from './workbench/Guide'
import { Screen } from './workbench/Screen'
import { changedFiles, entries, get, openEntry, openFile, set, setData, toast } from './workbench/store'
import { startClaude } from './sim/scenario'
import { registerTerminal } from './sim/term'
import { ShellTui } from './sim/shellTerm'

const data: DemoData = await fetch('./data/demo.json').then(r => r.json())
setData(data)

// What the pages inside the workbench (the canvas, the editors) may ask of it.
window.__axle = {
  edited: () => get().edited,
  kept: () => get().kept,
  keep: () => set({ kept: true }),
  undo: () => set({ edited: false, kept: false }),
}

registerTerminal(
  new ShellTui('shell-1', {
    dirty: () => get().edited,
    changedPaths: () => changedFiles().map(f => f.path),
    startClaude,
  }),
)

// The canvas and the code editors tell the workbench to open a file (a click on a card's file name).
window.addEventListener('message', e => {
  if (e.origin !== location.origin) return
  const m = e.data as { source?: string; type?: string; file?: string; line?: number; text?: string }
  if (m?.source !== 'axle-canvas') return
  if ((m.type === 'open' || m.type === 'reveal') && m.file && m.file.startsWith('/demo/')) {
    openFile(m.file.slice('/demo/'.length), { line: m.line })
  } else if (m.type === 'note' && m.text) {
    toast(m.text)
  }
})

// Opens as the real app did in the reference: the order controller on the left, its flow on the right.
const start = entries().find(e => e.http === 'POST /orders') ?? entries()[0]
openEntry(start)

document.getElementById('try')?.addEventListener('click', () => {
  document.getElementById('screen')?.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' })
  startClaude()
})

// Only where the screen is shown: on a phone the page shows the video, and the canvas, the editors and the dock (several MB) are not loaded.
const wide = matchMedia('(min-width: 900px)')
let mounted = false
const mountWorkbench = () => {
  if (mounted) return
  mounted = true
  createRoot(document.getElementById('screen-root')!).render(
    <>
      <Screen />
      <Guide />
    </>,
  )
}
if (wide.matches) mountWorkbench()
else wide.addEventListener('change', e => e.matches && mountWorkbench())
