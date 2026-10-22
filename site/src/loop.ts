// Silent looping clips: the hero loop (a capture of the real editor, public/media/hero-loop.*) and the problem sections' clips
// (clips.ts). They ship with `preload="none"` and a poster, so nothing but the poster loads until one is on screen; then it plays,
// muted and looped, and pauses when it scrolls away. Under prefers-reduced-motion it never plays (and stops if the visitor turns
// that on while it plays): the poster stays.

/**
 * Plays `video` (muted, inline, looped by its markup) while a quarter of it is on screen, unless the visitor asks for reduced motion.
 * The one place that decides when a clip on this site moves.
 */
export function playWhileVisible(video: HTMLVideoElement) {
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
  }, { threshold: 0.25 }).observe(video)
  still.addEventListener('change', update)
}

/** The hero loop. */
export function mountLoop(video: HTMLVideoElement | null) {
  if (video) playWhileVisible(video)
}
