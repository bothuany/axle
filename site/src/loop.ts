// The hero loop: a silent capture of the real editor (public/media/hero-loop.*). It ships with `preload="none"` and its poster, so
// nothing but the poster loads until it is on screen; then it plays, muted and looped, and pauses when it scrolls away. Under
// prefers-reduced-motion it never plays: the poster stays.
export function mountLoop(video: HTMLVideoElement | null) {
  if (!video) return
  const still = matchMedia('(prefers-reduced-motion: reduce)')
  // Muted inline playback is what lets a browser start it without a gesture; set as properties too, for the browsers that read those.
  video.muted = true
  video.playsInline = true
  let visible = false
  const update = () => {
    if (visible && !still.matches) {
      video.preload = 'auto'
      video.play().catch(() => {
        // A browser that refuses (data saver, low power) keeps the poster, which is the same picture.
      })
    } else video.pause()
  }
  new IntersectionObserver(([e]) => {
    visible = e.isIntersecting
    update()
  }, { threshold: 0.2 }).observe(video)
  still.addEventListener('change', update)
}
