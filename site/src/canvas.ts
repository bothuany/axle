// The canvas page: Insilode's real canvas from ui/, started on the fake host. The host goes first (it sets what the canvas reads at load).
import './host'
import '../../ui/src/webview'

// On a page that scrolls past the canvas (the home page's hero), a plain wheel must scroll the page, not zoom the canvas: the page
// marks its iframe `data-wheel="page"`, and only Ctrl or ⌘ with the wheel (which is also what a trackpad pinch sends) reaches the
// canvas. Read on every event, so the page can hand the wheel to the canvas when it opens it full screen.
window.addEventListener(
  'wheel',
  e => {
    const frame = window.frameElement as HTMLElement | null
    if (frame?.dataset.wheel !== 'page' || e.ctrlKey || e.metaKey) return
    e.preventDefault()
    e.stopPropagation()
    const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? window.innerHeight : 1
    window.parent.scrollBy({ left: e.deltaX * unit, top: e.deltaY * unit })
  },
  { capture: true, passive: false },
)
