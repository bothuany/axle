# Axle playground

Axle in the browser, with nothing to install: https://bothuany.github.io/axle/

One page, three things, no editor around them: the real flow canvas on a small fictional project (`demo/`: orders and shipping in Java, billing in Python), a short story where a scripted Claude changes it, and the harness scan of that project. A visitor opens an endpoint, presses "Watch Claude change it", and sees the Agents dock and the status overlay follow the agent, a permission question to answer, and then the change on the canvas, green and red, with Keep and Undo. A static site: no backend, no third-party scripts, nothing leaves the browser.

## What is Axle's own, and what is not

| Part | Where it comes from |
| --- | --- |
| Flow canvas | `ui/src/webview.tsx`, unchanged, on a fake host (`src/host.ts`); only its overview map is hidden (`canvas.html`) |
| Flows, callers, impact, tables, the change set | flow-view's code index (the polyglot worker) run on `demo/`, and its own `changeSet.ts` / `turnImpact.ts` |
| Agents dock page | `editor/extensions/flow-agent/src/dockPage.ts`: the page the app draws, driven by flow-agent's `attention.ts` ranking |
| Status overlay (the island) | the page inside `editor/patches/flow-desktop.patch`, cut out of the patch at build time, driven by flow-agent's `desktopModel.ts`; it floats on the stage here, in the app it hangs from the notch |
| Harness map | flow-harness's own `scan.ts` on the demo project, with an empty home folder; the page lays out its rows (`src/Harness.tsx`) |
| Theme | the variables of a running Axle (`src/theme/vscode-theme.css`) |
| **The agent** | **a scripted replay** (`src/story.ts`): its steps and timing are fixed |

The page says so itself, under the stage and in the notes at the bottom.

## How it fits together

- `src/main.tsx` loads `public/data/demo.json`, mounts the harness section, and (on a screen at least 900px wide) the stage. Below that nothing of the stage is mounted: the page shows the demo video instead, and no canvas is loaded.
- `src/Stage.tsx` is the stage: the canvas (an iframe), the dock beside it once an agent runs, the overlay on top, and a caption line that says what is happening and what to do. `src/pages.tsx` hosts the dock and overlay pages in iframes and answers what they ask for.
- `src/story.ts` plays the session: it drives `src/sessions.ts` (which turns the sessions into what the dock and the overlay are told, with flow-agent's ranking) and `src/store.ts` (the caption, whether the change is in the code, which flow is shown).
- `canvas.html` is the iframe page. It imports `ui/` after `src/host.ts` has set the globals the webview reads. `src/bridge.ts` is how that page asks the stage whether the change is in, and tells it Keep or Undo.
- `scripts/playground-data.mjs` builds the data: it runs the worker on two copies of the project (before the agent's change and with it), builds the change set and the turn's impact with flow-view's own code, scans the harness, and writes the dock and overlay pages into `public/pages/`. `public/data/`, `public/pages/` and `src/generated/` are generated and not committed.
- `playground/` may import only `ui/`, `protocol/` and these vscode-free files of flow-agent: `attention.ts`, `desktopModel.ts`, `avatars.ts`, `dockPage.ts`; and nothing it reaches may import `vscode` (`npm run arch`). The generated `src/generated/demo-check.ts` makes `npm run typecheck` fail when the data and the types of `protocol/flow.ts` disagree.

## Run it

```bash
(cd ui && npm ci)
(cd editor/extensions/flow-view && npm ci && node esbuild.mjs)
(cd editor/extensions/flow-harness && npm ci)
node scripts/playground-data.mjs        # public/data and public/pages
cd playground && npm ci
npm run typecheck && npm run build
npm run test:e2e                        # plays the story in headless Chrome (CHROME_PATH if it is not found)
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

- **A real recording** of a Claude Code session on the demo folder, to replace the scripted steps with what the CLI really did.
- **A second scenario** that ends on a question (the dock's "Question" chip) or an error, and a second agent in a worktree.
- **Context X-ray and the hooks studio**, the web pages of flow-harness, as pages of the demo.
- **More demo projects** in other languages, picked from the page.
- **Card editing** with saves kept in memory, so Keep and Undo work on edits the visitor makes.
