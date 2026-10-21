// The download buttons and the star count. The page ships with links to the releases page that work without any of this; once
// GitHub answers, each button points at the right file of the latest release for the visitor's OS.
import { ASSETS, NAME, PLATFORM_NAME, RELEASES, type Platform } from './brand'
import { detectPlatform, latestRelease, megabytes, starCount, type Release } from './github'

const OTHER: Record<Platform, Platform[]> = { windows: ['mac', 'linux'], mac: ['windows', 'linux'], linux: ['windows', 'mac'] }

function link(href: string, text: string) {
  const a = document.createElement('a')
  a.href = href
  a.textContent = text
  return a
}

/** "Version 0.4.3. Also for macOS and Linux." under a primary button. */
function platformsLine(el: HTMLElement, platform: Platform | null, release: Release | null) {
  el.textContent = release ? `Version ${release.version}, free and open source. ` : 'Free and open source. '
  const others = platform ? OTHER[platform] : (['windows', 'mac', 'linux'] as Platform[])
  el.append(platform ? 'Also for ' : 'For ')
  others.forEach((p, i) => {
    if (i) el.append(i === others.length - 1 ? ' and ' : ', ')
    el.append(link('#download', PLATFORM_NAME[p]))
  })
  el.append('.')
}

function primary(a: HTMLAnchorElement, platform: Platform | null, release: Release | null) {
  if (!platform) {
    // A phone or an OS without a build: the button leads to the list of every file.
    a.textContent = `Download ${NAME}`
    a.href = '#download'
    return
  }
  a.textContent = `Download for ${PLATFORM_NAME[platform]}`
  const asset = release?.assets.find(x => x.platform === platform)
  a.href = asset?.url ?? RELEASES
  if (asset) a.title = `${asset.label}, ${megabytes(asset.size)}`
}

/** The full list in the download section: every platform, every file, with sizes once GitHub has said them. */
function fullList(root: HTMLElement, release: Release | null, platform: Platform | null) {
  const order: Platform[] = platform ? [platform, ...OTHER[platform]] : ['windows', 'mac', 'linux']
  root.replaceChildren(
    ...order.map(p => {
      const group = document.createElement('div')
      group.className = 'dl-group'
      if (p === platform) group.dataset.mine = ''
      const h = document.createElement('h3')
      h.textContent = PLATFORM_NAME[p]
      const ul = document.createElement('ul')
      const files = release ? release.assets.filter(a => a.platform === p) : []
      const rows = files.length ? files.map(f => ({ label: f.label, url: f.url, size: megabytes(f.size) })) : ASSETS.filter(a => a.platform === p).map(a => ({ label: a.label, url: RELEASES, size: '' }))
      for (const r of rows) {
        const li = document.createElement('li')
        li.append(link(r.url, r.label))
        if (r.size) {
          const s = document.createElement('span')
          s.className = 'dl-size'
          s.textContent = r.size
          li.append(s)
        }
        ul.append(li)
      }
      group.append(h, ul)
      return group
    }),
  )
}

export function wireDownloads() {
  const platform = detectPlatform()
  const buttons = [...document.querySelectorAll<HTMLAnchorElement>('[data-download]')]
  const lines = [...document.querySelectorAll<HTMLElement>('[data-platforms]')]
  const list = document.querySelector<HTMLElement>('[data-download-list]')
  const version = document.querySelector<HTMLElement>('[data-release]')
  const draw = (release: Release | null) => {
    buttons.forEach(b => primary(b, platform, release))
    lines.forEach(l => platformsLine(l, platform, release))
    if (list) fullList(list, release, platform)
    if (version && release) {
      const when = new Date(release.date).toLocaleDateString('en', { year: 'numeric', month: 'long', day: 'numeric' })
      version.replaceChildren(link(release.url, `Version ${release.version}`), `, released ${when}.`)
    }
  }
  draw(null)
  latestRelease().then(r => r && draw(r))

  starCount().then(n => {
    if (n === null) return
    document.querySelectorAll<HTMLElement>('[data-stars]').forEach(el => {
      el.textContent = n.toLocaleString('en')
      el.hidden = false
      el.closest('a')?.setAttribute('aria-label', `${NAME} on GitHub, ${n} stars`)
    })
  })
}
