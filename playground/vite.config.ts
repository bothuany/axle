import react from '@vitejs/plugin-react'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { defineConfig, type Plugin } from 'vite'

/** Media the repo already has (README video and poster): emitted next to the site, not copied into playground/. */
const REPO_MEDIA: Record<string, string> = {
  'media/axle-poster.jpg': '../docs/media/axle-poster.jpg',
  'media/axle-demo.mp4': '../docs/media/axle-demo.mp4',
}
const TYPES: Record<string, string> = { '.mp4': 'video/mp4', '.jpg': 'image/jpeg' }
function repoMedia(): Plugin {
  return {
    name: 'axle-repo-media',
    generateBundle() {
      for (const [fileName, from] of Object.entries(REPO_MEDIA)) {
        this.emitFile({ type: 'asset', fileName, source: readFileSync(resolve(__dirname, from)) })
      }
    },
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const from = REPO_MEDIA[(req.url ?? '').split('?')[0].replace(/^\//, '')]
        if (!from) return next()
        res.setHeader('Content-Type', TYPES[from.slice(from.lastIndexOf('.'))] ?? 'application/octet-stream')
        res.end(readFileSync(resolve(__dirname, from)))
      })
    },
  }
}

// Served from https://<owner>.github.io/axle/: every URL is relative. The canvas page imports ui/ (a webview that expects
// the editor's globals, which src/host.ts supplies), so the dev server may read the repository root.
export default defineConfig({
  base: './',
  // One tsconfig for every file: the extension modules the playground imports (flow-agent's attention.ts and friends) sit in a
  // project that extends editor/vscode's, which a build without the VS Code checkout does not have.
  tsconfig: 'tsconfig.json',
  plugins: [react(), repoMedia()],
  server: { fs: { allow: ['..'] } },
  build: {
    target: 'esnext',
    outDir: 'dist',
    emptyOutDir: true,
    chunkSizeWarningLimit: 8000,
    rollupOptions: { input: { index: resolve(__dirname, 'index.html'), canvas: resolve(__dirname, 'canvas.html') } },
  },
})
