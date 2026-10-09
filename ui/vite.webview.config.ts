import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'node:path'

// The VS Code webview may run without a service worker (WKWebView), so it cannot fetch side files:
// build the canvas as exactly one JS and one CSS file that the extension inlines into the HTML.
export default defineConfig({
  plugins: [react()],
  build: {
    outDir: 'dist-webview',
    emptyOutDir: true,
    cssCodeSplit: false,
    assetsInlineLimit: 100_000_000,
    rollupOptions: {
      input: resolve(__dirname, 'src/webview.tsx'),
      output: {
        format: 'iife',
        inlineDynamicImports: true,
        entryFileNames: 'webview.js',
        assetFileNames: 'webview[extname]',
      },
    },
  },
})
