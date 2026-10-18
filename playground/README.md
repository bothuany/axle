# Axle playground

Axle in the browser, with nothing to install: https://bothuany.github.io/axle/

It is the real canvas from `ui/` running on a fake editor host, over demo data made from the real index. A static site, no backend, no third-party scripts.

## How it fits together

- **The canvas.** `canvas.html` loads `src/canvas.ts`, which imports `ui/src/webview.tsx`. That file is a VS Code webview: it asks its host for everything through `acquireVsCodeApi().postMessage`.
- **The fake host** (`src/host.ts`) plays that host. It answers `graph`, `callers`, `impact`, `timeline`, `editHooks`, `typeChips` and the rest from `demo.json`, and refuses `save`, `keep` and `undo` with a short read-only note. Messages that need an editor (`open`, `ask`, `mention`) become a note on the page.
- **The shell** (`index.html`, `src/shell.ts`, `src/style.css`) is the page around it: the hero, an endpoint picker and four guided steps. It loads the canvas in an iframe only when asked (the canvas carries a code editor, several MB), and talks to it with the same `show` and `cursor` messages the editor sends its webview. At phone width it shows the demo video instead.
- **The demo data** (`scripts/playground-data.mjs`) runs the vscode-free polyglot worker on `demo/` (fictional services: orders and shipping in Java, billing in Python) and writes `public/data/demo.json`: the entry points, each endpoint's flow, callers and impact, and an "an agent changed this" change set. The change set is two commits of the demo project; the diff is drawn by flow-view's own `changeSet.ts` / `changeSetTree.ts` / `turnImpact.ts`, bundled with a `vscode` stub the way flow-view's tests do. `demo.json` is generated, not committed.

`playground/` may import only `ui/` and `protocol/` (`npm run arch`). The wire types are the ones in `protocol/flow.ts`; `npm run typecheck` here checks the fake host and the shell against them.

## Run it

```bash
cd ui && npm ci && cd ..                                  # the canvas' dependencies (the playground imports its source)
cd editor/extensions/flow-view && npm ci && node esbuild.mjs && cd ../../..   # the index worker
node scripts/playground-data.mjs                          # playground/public/data/demo.json
cd playground && npm ci
npm run typecheck && npm run build
npm run preview                                           # http://127.0.0.1:4173/axle/
```

`npm run dev` serves the same thing with hot reload (at `/`, not `/axle/`).

## Deploys

`.github/workflows/playground.yml` builds and deploys to GitHub Pages on every push to `main`. The repository owner enables it once: Settings, Pages, Source "GitHub Actions".

## Later

- **A recorded Agents dock session**: the dock is native VS Code views, so a replay would be a recorded session (events from a real run) drawn by a small React view, not the dock itself.
- **A harness map view**: the map is a native tree. `flow-harness`'s scan output is plain data (vscode-free modules), so a React view over a scan of a demo `.claude/` folder could show the health score, lint and token costs.
- **More of the editor**: type chips and type diagrams (`typeChips`, `typeDetail`) from a demo type graph, and a migration in the change set (struck-through dropped columns).
- **More demo projects** in other languages, picked from the page.
- **Card editing** with saves kept in memory, so a visitor can see the Keep and Undo flow.
