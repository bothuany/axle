// The real canvas on a page: canvas.html (ui/ on the fake host) in an iframe, over a poster of itself. The iframe is made only when it
// is wanted (the page is idle, or the visitor reaches for it), so the canvas and its code editor never hold up the first paint, and the
// poster fades out only once the canvas has drawn its cards.
import { NAME } from './brand'
import type { Target } from './demo'
import type { Tour } from '../../protocol/flow'

export type Wheel = 'page' | 'canvas'

export interface StageOptions {
  /** canvas.html with its query (`?t=…&mode=changed`), relative to the page. */
  src: string
  /** `page`: a plain wheel scrolls the page and Ctrl or a pinch zooms the canvas; `canvas`: the canvas takes the wheel. */
  wheel: Wheel
  /** The canvas is not in the tab order until the visitor opens it (the hero); on the Try page it is. */
  tabbable: boolean
  onDecided?: (what: 'keep' | 'undo') => void
}

const wait = (ms: number) => new Promise(r => setTimeout(r, ms))

async function until<T>(probe: () => T | null | undefined | false, ms = 30_000): Promise<T | null> {
  const t0 = performance.now()
  while (performance.now() - t0 < ms) {
    const v = probe()
    if (v) return v
    await wait(120)
  }
  return null
}

export class Stage {
  readonly root: HTMLElement
  private frame?: HTMLIFrameElement
  private loading?: Promise<Window>
  private noteTimer = 0
  private shown?: string

  constructor(root: HTMLElement, private options: StageOptions) {
    this.root = root
    window.addEventListener('message', this.onMessage)
  }

  get window() {
    return this.frame?.contentWindow ?? null
  }

  /** Makes the iframe if there is none yet; resolves once the canvas has drawn. */
  load(): Promise<Window> {
    this.loading ??= new Promise<Window>(resolve => {
      const f = document.createElement('iframe')
      f.className = 'stage-frame'
      f.title = `${NAME} canvas on a demo project`
      f.src = this.options.src
      f.dataset.wheel = this.options.wheel
      if (!this.options.tabbable) f.tabIndex = -1
      f.addEventListener('load', async () => {
        const doc = f.contentDocument
        await until(() => doc?.querySelector('.react-flow__node'))
        // The canvas fits its cards to the view in an animation of its own (250 ms) after the first draw.
        await wait(400)
        this.root.classList.add('is-live')
        resolve(f.contentWindow!)
      })
      this.frame = f
      this.root.prepend(f)
    })
    return this.loading
  }

  /** Starts the canvas again on another page state (canvas.html's query): the fake host reads it once, at load. */
  reload(src: string) {
    this.options.src = src
    this.root.classList.remove('is-live')
    this.frame?.remove()
    this.frame = undefined
    this.loading = undefined
    this.shown = undefined
    return this.load()
  }

  /** Loads when the browser has nothing better to do, after the page itself has loaded. */
  loadWhenIdle() {
    const go = () => ('requestIdleCallback' in window ? requestIdleCallback(() => this.load(), { timeout: 4000 }) : setTimeout(() => this.load(), 1500))
    if (document.readyState === 'complete') go()
    else window.addEventListener('load', go, { once: true })
  }

  setWheel(wheel: Wheel) {
    this.options.wheel = wheel
    if (this.frame) this.frame.dataset.wheel = wheel
  }

  setTabbable(on: boolean) {
    this.options.tabbable = on
    if (this.frame) this.frame.tabIndex = on ? 0 : -1
  }

  private post(m: unknown) {
    this.window?.postMessage(m, location.origin)
  }

  /** Opens a flow, and waits until its first card is on the canvas. */
  async show(target: Target, label: string) {
    await this.load()
    if (this.shown === `${target.kind}:${target.id}`) return
    this.post({ type: 'show', target, label })
    this.shown = `${target.kind}:${target.id}`
    const doc = this.frame?.contentDocument
    await until(() => [...(doc?.querySelectorAll('.react-flow__node') ?? [])].some(n => n.textContent?.includes(label.split('.').pop() ?? label)))
    await wait(250)
  }

  /** Plays a guided tour on its endpoint's flow: the canvas's own tour player, with its ghost cursor. */
  async play(tour: Tour & { entry: string }, label: string) {
    await this.show({ kind: 'poly', id: tour.entry }, label)
    this.post({ type: 'tour', tour })
  }

  /** The canvas's own review of an agent's change ("Review 2 changes"), on a canvas that shows the change set. */
  async review() {
    await this.load()
    const doc = this.frame?.contentDocument
    const button = await until(() => doc?.querySelector<HTMLButtonElement>('button.chip.agent'))
    button?.click()
  }

  note(text: string) {
    const el = this.root.querySelector<HTMLElement>('.stage-note')
    if (!el) return
    el.textContent = text
    el.hidden = false
    clearTimeout(this.noteTimer)
    this.noteTimer = window.setTimeout(() => (el.hidden = true), 6000)
  }

  private onMessage = (e: MessageEvent) => {
    if (!this.frame || e.source !== this.frame.contentWindow || e.origin !== location.origin) return
    const m = e.data as { source?: string; type?: string; text?: string; what?: 'keep' | 'undo'; file?: string }
    if (m?.source !== 'insilode-canvas') return
    if (m.type === 'note' && m.text) this.note(m.text)
    else if (m.type === 'open' || m.type === 'reveal') this.note(`Opening ${m.file?.split('/').pop() ?? 'a file'} in the editor works in the ${NAME} app, on your own code.`)
    else if (m.type === 'decided' && m.what) this.options.onDecided?.(m.what)
  }
}
