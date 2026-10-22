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
  // The dialog element is the backdrop's area: a click on it, not on its content, is a click outside the player.
  dialog.addEventListener('click', e => {
    if (e.target === dialog) dialog.close()
  })
  dialog.addEventListener('close', () => {
    video.pause()
    video.currentTime = 0
    open.focus()
  })
}
