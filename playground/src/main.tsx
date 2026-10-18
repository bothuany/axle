// The playground page: loads the demo data, mounts the harness section, and (on a screen wide enough) the stage with the real canvas.
import { createRoot } from 'react-dom/client'
import './theme/vscode-theme.css'
import './style.css'
import type { DemoData } from './demo'
import { Harness } from './Harness'
import { Stage } from './Stage'
import { get, note, setData } from './store'
import { keep, start, undo } from './story'

const data: DemoData = await fetch('./data/demo.json').then(r => r.json())
setData(data)

// What the canvas page (an iframe of this site) may ask of the page around it: whether the change is in, and the answer to Keep or Undo.
window.__axle = {
  edited: () => get().edited,
  kept: () => get().kept,
  keep,
  undo,
}

// The canvas asks for things only the app can do (open the file in an editor, hand the flow to an agent): say what the app would do.
window.addEventListener('message', e => {
  if (e.origin !== location.origin) return
  const m = e.data as { source?: string; type?: string; text?: string }
  if (m?.source !== 'axle-canvas') return
  if (m.type === 'open' || m.type === 'reveal') note('In the Axle app this opens the file in the editor, at that line.')
  else if (m.type === 'note' && m.text) note(m.text)
})

createRoot(document.getElementById('harness-root')!).render(<Harness />)

document.getElementById('try')?.addEventListener('click', start)

// Only where the stage is shown: on a phone the page shows the video, and the canvas and the dock (several MB) are not loaded.
const wide = matchMedia('(min-width: 900px)')
let mounted = false
const mountStage = () => {
  if (mounted) return
  mounted = true
  createRoot(document.getElementById('stage-root')!).render(<Stage />)
}
if (wide.matches) mountStage()
else wide.addEventListener('change', e => e.matches && mountStage())
