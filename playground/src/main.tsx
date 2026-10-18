// The playground page: loads the demo data and mounts the live tiles into the page's text. The harness map is on every screen; the tiles
// with the canvas and the dock only on a screen wide enough (on a phone the page shows the video, and nothing heavy is loaded).
import { createRoot } from 'react-dom/client'
import './theme/vscode-theme.css'
import './style.css'
import type { DemoData } from './demo'
import { Harness } from './Harness'
import { AgentsTile, FlowTile, orderedEntries, touchedEntries } from './Tiles'
import { setData } from './store'
import { start } from './story'

const data: DemoData = await fetch('./data/demo.json').then(r => r.json())
setData(data)

const mount = (id: string, node: React.ReactNode) => createRoot(document.getElementById(id)!).render(node)
mount('harness-root', <Harness />)

document.getElementById('try')?.addEventListener('click', start)

const wide = matchMedia('(min-width: 900px)')
let mounted = false
const mountTiles = () => {
  if (mounted) return
  mounted = true
  const before = orderedEntries(data.before.entries)
  const order = before.find(e => e.http === 'POST /orders') ?? before[0]
  const touched = touchedEntries()
  mount(
    'tile-flow',
    <FlowTile
      id="flow-tile"
      mode="before"
      entries={before}
      first={order.id}
      eager
      hint="Pick an endpoint. Its callers are on the left, what it runs on the right, down to the table it writes. A dashed link is a guess, and says so."
    />,
  )
  mount('tile-agents', <AgentsTile />)
  mount(
    'tile-changes',
    <FlowTile
      id="changes-tile"
      mode="changed"
      entries={touched}
      first={(touched.find(e => e.http === 'POST /orders') ?? touched[0]).id}
      hint="Green is what Claude added, red what it removed. The canvas steps through the changed cards (‹ ›, or the [ and ] keys): keep the change, or undo it. The endpoints listed are the ones its turn touched."
    />,
  )
}
if (wide.matches) mountTiles()
else wide.addEventListener('change', e => e.matches && mountTiles())
