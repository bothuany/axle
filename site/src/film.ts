// The launch film in a modal player. A native <dialog> opened with showModal(): the rest of the page is inert while it is open,
// so focus stays inside it, and Esc closes it. A click on the backdrop closes it too. It plays with sound only because the
// visitor clicked Watch the film; closing stops it and rewinds it, so the next opening starts from the beginning.
export function mountFilm(open: HTMLElement | null, dialog: HTMLDialogElement | null) {
  if (!open || !dialog) return
  const video = dialog.querySelector<HTMLVideoElement>('video')
  const close = dialog.querySelector<HTMLButtonElement>('[data-film-close]')
  if (!video || !close) return

  open.addEventListener('click', () => {
    dialog.showModal()
    close.focus()
    video.muted = false
    video.play().catch(() => {
      // A browser that will not start it keeps its controls and poster: the visitor presses play.
    })
  })
  close.addEventListener('click', () => dialog.close())
  // A click on the backdrop closes it. The dialog element is the target of a backdrop click, but also of a click on its own
  // padding or scrollbar, and of a click that ends there after a drag (selecting transcript text): so the press and the release
  // must both be outside the dialog's box.
  const outside = (e: MouseEvent) => {
    const r = dialog.getBoundingClientRect()
    return e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom
  }
  let pressedOutside = false
  dialog.addEventListener('pointerdown', e => {
    pressedOutside = e.target === dialog && outside(e)
  })
  dialog.addEventListener('click', e => {
    if (pressedOutside && e.target === dialog && outside(e)) dialog.close()
    pressedOutside = false
  })
  dialog.addEventListener('close', () => {
    video.pause()
    video.currentTime = 0
    open.focus()
  })
}
