import react from '@vitejs/plugin-react'
import { createReadStream, existsSync, readdirSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { defineConfig, type Plugin } from 'vite'
import { NAME, REPO } from './src/brand.ts'

/** Where the site is served from: pages that must name their own address (the canonical link, the social cards, the sitemap) use it. */
const SITE = (process.env.SITE_URL || 'https://insilode.dev').replace(/\/$/, '')
/** The documentation pages scripts/docs-pages.mjs has written (docs/ and docs/<page>/). */
const DOC_PAGES = existsSync(resolve(import.meta.dirname, 'docs'))
  ? ['docs/', ...readdirSync(resolve(import.meta.dirname, 'docs'), { withFileTypes: true }).filter(d => d.isDirectory()).map(d => `docs/${d.name}/`)]
  : []
/** The launch film the home page plays in its modal: served from the repository's own copy (docs/media/film), not a second one. */
const FILM_DIR = resolve(import.meta.dirname, '../docs/media/film')
const FILM = ['launch-film.mp4', 'launch-film-poster.jpg']
/** The released version, for the structured data (the root package.json is bumped by every release). */
const VERSION = JSON.parse(readFileSync(resolve(import.meta.dirname, '../package.json'), 'utf8')).version as string
const robots = () => `User-agent: *\nAllow: /\n\nSitemap: ${SITE}/sitemap.xml\n`
const PAGES = ['', 'try/', ...DOC_PAGES]

/**
 * Writes the site's address and the product's name into the pages (`{{site}}`, `{{name}}`, `{{repo}}`, all from src/brand.ts and
 * SITE_URL), and emits sitemap.xml, dated with the build.
 */
function site(): Plugin {
  const sitemap = (lastmod?: string) =>
    `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${PAGES.map(p => `  <url><loc>${SITE}/${p}</loc>${lastmod ? `<lastmod>${lastmod}</lastmod>` : ''}</url>`).join('\n')}\n</urlset>\n`
  return {
    name: 'insilode-site',
    transformIndexHtml: html => html.replaceAll('{{site}}', SITE).replaceAll('{{name}}', NAME).replaceAll('{{repo}}', REPO).replaceAll('{{version}}', VERSION),
    generateBundle() {
      for (const f of FILM) this.emitFile({ type: 'asset', fileName: `media/film/${f}`, source: readFileSync(resolve(FILM_DIR, f)) })
      this.emitFile({ type: 'asset', fileName: 'sitemap.xml', source: sitemap(new Date().toISOString().slice(0, 10)) })
      // The site is the root of its domain (insilode.dev), so robots.txt there is the one crawlers read: everything may be crawled, and here is the sitemap.
      this.emitFile({ type: 'asset', fileName: 'robots.txt', source: robots() })
      // GitHub Pages keeps a custom domain only while the published folder carries a CNAME file: without it a deploy drops the domain. Not on <owner>.github.io.
      const host = new URL(SITE).hostname
      if (!host.endsWith('.github.io')) {
        this.emitFile({ type: 'asset', fileName: 'CNAME', source: `${host}
` })
      }
    },
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const film = FILM.find(f => (req.url ?? '').split('?')[0] === `/media/film/${f}`)
        if (film) {
          res.setHeader('Content-Type', film.endsWith('.mp4') ? 'video/mp4' : 'image/jpeg')
          createReadStream(resolve(FILM_DIR, film)).pipe(res)
          return
        }
        if ((req.url ?? '').split('?')[0] === '/robots.txt') {
          res.setHeader('Content-Type', 'text/plain')
          res.end(robots())
          return
        }
        if ((req.url ?? '').split('?')[0] !== '/sitemap.xml') return next()
        res.setHeader('Content-Type', 'application/xml')
        res.end(sitemap())
      })
    },
  }
}

// Served from the root of https://insilode.dev (GitHub Pages, custom domain), and still correct under a sub-path such as <owner>.github.io/<repo>/: every URL is relative. The canvas page imports ui/ (a webview that expects the editor's
// globals, which src/host.ts supplies), so the dev server may read the repository root.
export default defineConfig({
  base: './',
  // One tsconfig for every file: the extension modules the site imports (flow-agent's attention.ts and friends) sit in a project
  // that extends editor/vscode's, which a build without the VS Code checkout does not have.
  tsconfig: 'tsconfig.json',
  plugins: [react(), site()],
  server: { fs: { allow: ['..'] } },
  build: {
    target: 'esnext',
    outDir: 'dist',
    emptyOutDir: true,
    chunkSizeWarningLimit: 8000,
    rollupOptions: {
      input: {
        index: resolve(import.meta.dirname, 'index.html'),
        try: resolve(import.meta.dirname, 'try/index.html'),
        canvas: resolve(import.meta.dirname, 'canvas.html'),
        ...Object.fromEntries(DOC_PAGES.map(p => [p.replace(/\/$/, '').replace('/', '-'), resolve(import.meta.dirname, p, 'index.html')])),
      },
    },
  },
})
