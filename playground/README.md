# Axle playground

Axle in the browser, with nothing to install: https://bothuany.github.io/axle/

A Mac screen with the Axle window on it, running on a small fictional project (`demo/`: orders and shipping in Java, billing in Python). A visitor starts Claude from the Agents dock and watches the dock, the desktop overlay at the notch, the terminal and the flow canvas follow it: it reads, asks the `axle` MCP who is affected, asks before it edits, edits, runs the tests, and the dock lists the flows the turn touched. A static site: no backend, no third-party scripts, nothing leaves the browser.

## What is Axle's own, and what is not

| Part | Where it comes from |
| --- | --- |
| Flow canvas | `ui/src/webview.tsx`, unchanged, on a fake host (`src/host.ts`) |
| Flows, callers, impact, tables, the change set | flow-view's code index (the polyglot worker) run on `demo/`, and its own `changeSet.ts` / `turnImpact.ts` |
| Agents dock page | `editor/extensions/flow-agent/src/dockPage.ts`: the page the app draws, driven by flow-agent's `attention.ts` ranking |
| Desktop overlay (the notch island) | the page inside `editor/patches/flow-desktop.patch`, cut out of the patch at build time, driven by flow-agent's `desktopModel.ts` |
| Harness map | flow-harness's own `scan.ts` on the demo project, with an empty home folder |
| Theme | the variables of a running Axle (`src/theme/vscode-theme.css`) |
| Code editor | Monaco, the editor VS Code is made of, with Axle Dark's token colours |
| Terminal | xterm.js, the terminal VS Code uses |
| Workbench layout (title bar, sidebar, tabs, panel, status bar) | drawn here, to the pixel sizes measured in a running Axle |
| **The agent** | **a scripted replay** (`src/sim/scenario.ts`): its words, tool calls and timing are fixed; the terminal takes only the keys the replay expects |

The page says so itself, in the guide under the screen and in the notes below it.

## How it fits together

- `src/main.tsx` loads `public/data/demo.json` and mounts `workbench/Screen.tsx`. Below 900px wide nothing of the workbench is mounted: the page shows the demo video instead.
- `src/workbench/` is the window: `store.ts` (what is open, whether the agent's change is in the files), `views.tsx` and `harness.tsx` (the sidebar), `editor.tsx` (code and canvas groups, an iframe each), `panel.tsx` (terminals), `pages.tsx` (the dock and the overlay in iframes), `Guide.tsx`.
- `src/sim/` is the session: `scenario.ts` plays it, `sessions.ts` turns the sessions into what the dock and the overlay are told, `claudeTui.ts` draws a Claude Code terminal (output scrolling above, the prompt or a permission question pinned below), `shellTerm.ts` is the shell tab.
- `canvas.html` and `editor.html` are iframe pages. The canvas page imports `ui/` after `src/host.ts` has set the globals the webview reads. `src/bridge.ts` is how those pages ask the workbench whether the change is in, and tell it Keep or Undo.
- `scripts/playground-data.mjs` builds the data: it runs the worker on two copies of the project (before the agent's change and with it), builds the change set and the turn's impact with flow-view's own code, scans the harness, lists the files, and writes the dock and overlay pages into `public/pages/`. `public/data/`, `public/pages/` and `src/generated/` are generated and not committed.
- `playground/` may import only `ui/`, `protocol/` and these vscode-free files of flow-agent: `attention.ts`, `desktopModel.ts`, `avatars.ts`, `dockPage.ts`; and nothing it reaches may import `vscode` (`npm run arch`). The generated `src/generated/demo-check.ts` makes `npm run typecheck` fail when the data and the types of `protocol/flow.ts` disagree.

## Run it

```bash
(cd ui && npm ci)
(cd editor/extensions/flow-view && npm ci && node esbuild.mjs)
(cd editor/extensions/flow-harness && npm ci)
node scripts/playground-data.mjs        # public/data and public/pages
cd playground && npm ci
npm run typecheck && npm run build
npm run test:e2e                        # plays the demo in headless Chrome (CHROME_PATH if it is not found)
npm run preview                         # http://127.0.0.1:4173/axle/
```

`npm run dev` serves it with hot reload (at `/`, not `/axle/`). In Git Bash on Windows `/axle/` in the preview script is rewritten to a path: run it from PowerShell.

## Capturing the theme again

`src/theme/vscode-theme.css` was captured from Axle 0.3.1. To refresh it after a theme change, run `npm run web`, open the workbench and run this in the browser console, then keep the `--vscode-*` entries the file already has (the icon glyph tables and the parts the playground does not draw are left out):

```js
const cs = getComputedStyle(document.querySelector('.monaco-workbench'))
copy(Object.fromEntries([...cs].filter(n => n.startsWith('--vscode-') && !n.startsWith('--vscode-icon-')).map(n => [n, cs.getPropertyValue(n).trim()])))
```

## Deploys

`.github/workflows/playground.yml` builds, tests and deploys to GitHub Pages on every push to `main`. The repository owner enables it once: Settings, Pages, Source "GitHub Actions". `ci.yml` builds and tests it on pull requests too.

## Later

- **A real recording** of a Claude Code session on the demo folder, to replace the scripted words (and the terminal's layout) with what the CLI really printed.
- **A second scenario** that ends on a question (the dock's "Question" chip), an error (the "Error" chip), and a second agent in a worktree (the clash line).
- **Context X-ray and the hooks studio**, the web pages of flow-harness, as pages of the demo.
- **Type chips and diagrams** on the canvas, from a demo type graph.
- **More demo projects** in other languages, picked from the page.
- **Card editing** with saves kept in memory, so Keep and Undo work on edits the visitor makes.
