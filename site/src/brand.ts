// The product's name and where it lives, in one place: the pages (through vite.config.ts's `{{name}}`), the scripts, the alt texts and
// the release assets the download buttons look for all read it from here, so a rename is a change to this file.

export const NAME = 'Axle'
export const REPO = 'bothuany/axle'
export const GITHUB = `https://github.com/${REPO}`
export const RELEASES = `${GITHUB}/releases/latest`

export type Platform = 'windows' | 'mac' | 'linux'

/**
 * The release assets, matched by their platform suffix rather than by name, so that a rename or a new version cannot break a
 * button. The first match of a platform is its primary download.
 */
export const ASSETS: { platform: Platform; label: string; match: RegExp }[] = [
  { platform: 'windows', label: 'Windows installer (64-bit)', match: /-Setup-.*-x64\.exe$/i },
  { platform: 'mac', label: 'macOS, Apple silicon (.dmg)', match: /darwin-arm64\.dmg$/i },
  { platform: 'mac', label: 'macOS, Intel (.dmg)', match: /darwin-x64\.dmg$/i },
  { platform: 'linux', label: 'Debian and Ubuntu (.deb)', match: /_amd64\.deb$/i },
  { platform: 'linux', label: 'Fedora and RHEL (.rpm)', match: /x86_64\.rpm$/i },
  { platform: 'linux', label: 'Any Linux (.tar.gz)', match: /linux-x64\.tar\.gz$/i },
]

export const PLATFORM_NAME: Record<Platform, string> = { windows: 'Windows', mac: 'macOS', linux: 'Linux' }
