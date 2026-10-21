import react from '@vitejs/plugin-react'
import { resolve } from 'node:path'
import { defineConfig, type Plugin } from 'vite'
import { NAME, REPO } from './src/brand.ts'

/** Where the site is served from: pages that must name their own address (the canonical link, the social cards, the sitemap) use it. */
const SITE = (process.env.SITE_URL ?? 'https://bothuany.github.io/axle').replace(/\/$/, '')
const PAGES = ['', 'try/']

/**
 * Writes the site's address and the product's name into the pages (`{{site}}`, `{{name}}`, `{{repo}}`, all from src/brand.ts and
 * SITE_URL), and emits sitemap.xml, dated with the build.
 */
function site(): Plugin {
  const sitemap = (lastmod?: string) =>
    `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${PAGES.map(p => `  <url><loc>${SITE}/${p}</loc>${lastmod ? `<lastmod>${lastmod}</lastmod>` : ''}</url>`).join('\n')}\n</urlset>\n`
  return {
    name: 'axle-site',
    transformIndexHtml: html => html.replaceAll('{{site}}', SITE).replaceAll('{{name}}', NAME).replaceAll('{{repo}}', REPO),
    generateBundle() {
      this.emitFile({ type: 'asset', fileName: 'sitemap.xml', source: sitemap(new Date().toISOString().slice(0, 10)) })
    },
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if ((req.url ?? '').split('?')[0] !== '/sitemap.xml') return next()
        res.setHeader('Content-Type', 'application/xml')
        res.end(sitemap())
      })
    },
  }
}

// Served from https://<owner>.github.io/axle/: every URL is relative. The canvas page imports ui/ (a webview that expects the editor's
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
      },
    },
  },
})
