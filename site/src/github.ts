// What the page reads from GitHub: the star count and the latest release with its files. Both are optional: when the API is
// unreachable or rate-limited, the page keeps what it shows without them (no count, links to the releases page), and never a made-up
// number.
import { ASSETS, REPO, type Platform } from './brand'

export interface Asset {
  platform: Platform
  label: string
  url: string
  size: number
}

export interface Release {
  version: string
  date: string
  url: string
  assets: Asset[]
}

/** How long an answer is reused in this browser: GitHub allows a visitor 60 unauthenticated requests an hour. */
const FRESH_MS = 30 * 60_000

function cached<T>(key: string): T | null {
  try {
    const hit = JSON.parse(localStorage.getItem(key) ?? 'null') as { at: number; body: T } | null
    return hit && Date.now() - hit.at < FRESH_MS ? hit.body : null
  } catch {
    return null
  }
}

const api = async <T>(path: string): Promise<T | null> => {
  const key = `gh:${REPO}${path}`
  const hit = cached<T>(key)
  if (hit) return hit
  try {
    const r = await fetch(`https://api.github.com/repos/${REPO}${path}`, { headers: { Accept: 'application/vnd.github+json' } })
    if (!r.ok) return null
    const body = (await r.json()) as T
    try {
      localStorage.setItem(key, JSON.stringify({ at: Date.now(), body }))
    } catch {
      // No storage (a private window, blocked site data): the next page asks again.
    }
    return body
  } catch {
    return null
  }
}

let stars: Promise<number | null> | undefined
export const starCount = () => (stars ??= api<{ stargazers_count: number }>('').then(r => (r && typeof r.stargazers_count === 'number' ? r.stargazers_count : null)))

let release: Promise<Release | null> | undefined
export function latestRelease() {
  release ??= api<{ tag_name: string; published_at: string; html_url: string; assets: { name: string; browser_download_url: string; size: number }[] }>('/releases/latest').then(r => {
    if (!r || !Array.isArray(r.assets)) return null
    const assets = ASSETS.flatMap(a => {
      const hit = r.assets.find(x => a.match.test(x.name))
      return hit ? [{ platform: a.platform, label: a.label, url: hit.browser_download_url, size: hit.size }] : []
    })
    return { version: r.tag_name.replace(/^v/, ''), date: r.published_at, url: r.html_url, assets }
  })
  return release
}

/** The visitor's OS, as far as the browser says. Apple silicon and Intel Macs look the same here, so a Mac gets both. */
export function detectPlatform(): Platform | null {
  const ua = navigator.userAgent
  if (/Windows/i.test(ua)) return 'windows'
  if (/Android|iPhone|iPad|iPod/i.test(ua)) return null
  if (/Mac OS X|Macintosh/i.test(ua)) return 'mac'
  if (/Linux|X11/i.test(ua)) return 'linux'
  return null
}

export const megabytes = (bytes: number) => `${Math.round(bytes / 1_000_000)} MB`
