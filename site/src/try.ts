// The Try page: the canvas with three stories a guide walks (two tours of the demo's flows and the canvas's own review of an agent's
// change), and the Agents dock with the status island.
import './site.css'
import { allowWaiting, mountAgents } from './agents'
import type { DemoData } from './demo'
import { wireDownloads } from './download'
import { Stage } from './stage'

wireDownloads()

const data: Promise<DemoData> = fetch('../data/demo.json').then(r => r.json())
const decision = document.querySelector<HTMLElement>('[data-decision]')!
const stage = new Stage(document.querySelector<HTMLElement>('[data-stage]')!, {
  src: '../canvas.html',
  wheel: 'canvas',
  tabbable: true,
  onDecided: what => {
    decision.textContent = what === 'keep' ? 'Kept. In the app the change stays in your code, and the cards go back to plain.' : 'Undone. In the app the agent’s edit is reverted in your files; here the demo goes back to the code before it.'
  },
})

type Story = 'order' | 'changes' | 'invoice'
const LABELS: Record<Exclude<Story, 'changes'>, string> = { order: 'OrderController.place', invoice: 'OrderController.invoice' }
const buttons = [...document.querySelectorAll<HTMLButtonElement>('[data-story]')]
let current: Story | undefined
let mode: 'plain' | 'changed' | undefined

async function play(story: Story) {
  current = story
  buttons.forEach(b => b.setAttribute('aria-pressed', String(b.dataset.story === story)))
  if (story === 'changes') {
    decision.textContent = 'The review steps through each changed card. Keep or Undo is on every card.'
    mode = 'changed'
    await stage.reload('../canvas.html?t=changes&mode=changed')
    if (current === story) await stage.review()
    return
  }
  decision.textContent = 'Use the arrows in the tour bar, or press the arrow keys. Drag to move around; scroll or pinch to zoom.'
  // The tours play on the project as committed: after the change story, the canvas starts again without the change.
  if (mode !== 'plain') {
    mode = 'plain'
    await stage.reload('../canvas.html')
  }
  const tour = (await data).tours.find(t => t.id === story)
  if (tour && current === story) await stage.play(tour, LABELS[story])
}

buttons.forEach(b => b.addEventListener('click', () => play(b.dataset.story as Story)))
const fromHash = location.hash.slice(1)
play(fromHash === 'changes' || fromHash === 'invoice' ? fromHash : 'order')

const dock = document.querySelector<HTMLIFrameElement>('iframe.dock')!
const island = document.querySelector<HTMLIFrameElement>('iframe.island')!
const agentsNote = document.querySelector<HTMLElement>('[data-agents-note]')!
data.then(d => mountAgents(dock, island, d, text => (agentsNote.textContent = text)))
const allow = document.querySelector<HTMLButtonElement>('[data-allow]')!
allow.addEventListener('click', () => {
  if (allowWaiting()) {
    allow.disabled = true
    allow.textContent = 'Allowed'
  }
})
