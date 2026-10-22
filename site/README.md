# The website

https://insilode.dev/: the home page and the Try page, with the real canvas on a fictional demo project (`demo/`: orders and shipping in Java, billing in Python). A static site: no backend, and the only third-party request is GitHub's public API (the star count and the latest release). The design and its reasoning are in [docs/site/direction](../docs/site/direction/README.md) (direction A, "Light table"), now on a dark page: the site has one theme, dark, like every marketing visual ([docs/design/messaging.md](../docs/design/messaging.md)). The palette and its contrast ratios are at the top of `src/site.css`.

## The pages

- **Home** (`index.html`, `src/home.ts`): the slogan ("Every code editor shows how code is stored. Insilode shows how it runs.") and the subhead that says it is built on VS Code (the wording and the type, Instrument Sans and JetBrains Mono, are in [docs/design/messaging.md](../docs/design/messaging.md)) over a capture of the real editor window, which links to the Try page; "Built on VS Code" (what carries over from VS Code); then what the editor adds: the live canvas over a poster of itself, with a button that plays a guided tour; one section per problem, each with a still in a clip slot; how it works with Claude Code, Codex and MCP; what a visitor can check (licence, releases, CI, this folder); the downloads.
- **Try** (`try/index.html`, `src/try.ts`): the canvas large with three stories (two guided tours and the canvas's own review of an agent's change, with Keep and Undo), and the Agents dock with the status island, in either of the app's avatar styles (gyro or pixel). `#order`, `#changes` and `#invoice` in the address play that story at once.
- **Docs** (`docs/`, `src/docs.ts`): the repository's own Markdown as pages of the site: `README.md` (from its first section) and `docs/building.md`, `languages.md`, `agent-tools.md` and `boards.md`. `scripts/docs-pages.mjs` writes them before every build and dev start (generated, not committed); links between these documents stay on the site, links to any other file go to it on GitHub.
- **canvas.html**: the iframe page both use. It imports `ui/` after `src/host.ts` has set the globals the webview reads.

## What is Insilode's own, and what is not

| Part | Where it comes from |
| --- | --- |
| Canvas | `ui/src/webview.tsx`, unchanged, on a fake host (`src/host.ts`); only its overview map is hidden (`canvas.html`) |
| Flows, callers, impact, tables, the change set | flow-view's code index (the polyglot worker) run on `demo/`, and its own `changeSet.ts` / `turnImpact.ts` |
| Guided tours | written by hand in `demo/tours.json` by card label and line text; `scripts/site-data.mjs` resolves them against the index (it fails when a card or a line is gone), and the canvas's own tour player plays them |
| Agents dock and status island | the app's own pages (flow-agent's `dockPage.ts`, the island page inside `editor/patches/flow-desktop.patch`), ranked and mapped by flow-agent's `attention.ts` and `desktopModel.ts` |
| **The three agents** | **written for the page** (`src/agents.ts`): a fixed moment, not a live session; "Allow the test run" moves the waiting one on |
| Harness section | flow-harness's own scan of the demo project, drawn by the page (`src/clips.ts`) |
| Stills | headless captures of this site's own canvas and Try page (`scripts/capture-media.mjs`), committed in `public/media/` |
| Editor window (`public/media/editor.webp`, `editor-narrow.webp`, `editor.jpg`; the README's `docs/media/insilode-editor.webp`) | a headless capture (puppeteer, 1680x1050 at 2x) of the real workbench in web mode (`npm run web`) on a copy of `demo/base` with `demo/changed` left uncommitted, with Claude Code started from the Agents dock and no prompt sent. The copy's `.vscode/settings.json` sets the dark theme (`Default Dark Modern`), the DOM terminal renderer (the GPU one draws text at twice its size in headless Chrome at 2x) and hides `.vscode` itself, which `.git/info/exclude` keeps out of source control. The code tab and the flow tab share one group, so the canvas is wide enough to show the whole `POST /orders` chain at a readable size. The narrow one is its left 900 px. Only the web build's test status items (`Hello`, the keyboard layout) and the canvas's overview map (as on this site) are hidden. Capture it again after a visible change to the workbench |

## How it fits together

- **The name** of the product is in `src/brand.ts` only: the pages get it through `{{name}}` (and `{{repo}}`, `{{site}}`), filled by `vite.config.ts`; the scripts import it. The download buttons match release files by their platform suffix, not by name.
- **The live canvas** (`src/stage.ts`, under "What Insilode adds to VS Code") is an iframe made when the page is idle (on a phone, only when the visitor taps "Explore the flow", then full screen). The poster gives way once the canvas has drawn its cards. A plain wheel over it scrolls the page and Ctrl or a pinch zooms: the page marks the iframe `data-wheel="page"` and `src/canvas.ts` passes the wheel up. It is out of the tab order until the visitor plays the tour or opens it.
- **Downloads and stars** (`src/download.ts`, `src/github.ts`): the page ships with links to the releases page; once GitHub answers, the primary button points at the visitor's file (a Mac gets the Apple silicon image, a phone the list), and answers are kept in `localStorage` for 30 minutes. No answer: no count, and the links stay on the releases page.
- **Clip slots** (`src/clips.ts`): each problem section names a slot (`data-clip`). A slot is a still until it gets `video` (a silent loop under `public/media/`); loops play only on screen and never under reduced motion.
- `scripts/site-data.mjs` builds the data: it runs the worker on two copies of the project (before the agent's change and with it), builds the change set and the turn's impact with flow-view's own code, resolves the tours, scans the harness, and writes the dock and island pages into `public/pages/`. `public/data/`, `public/pages/` and `src/generated/` are generated and not committed.
- `site/` may import only `ui/`, `protocol/` and these vscode-free files of flow-agent: `attention.ts`, `desktopModel.ts`, `avatars.ts`, `dockPage.ts`; nothing it reaches may import `vscode` (`npm run arch`). The generated `src/generated/demo-check.ts` makes `npm run typecheck` fail when the data and `protocol/flow.ts` disagree.

## Being found

Each page sets its title, description, canonical address, Open Graph tags and a Content-Security-Policy; the home page adds `SoftwareApplication` JSON-LD and the `google-site-verification` tag. `{{site}}` comes from `SITE_URL` (default `https://insilode.dev`). The build emits `sitemap.xml` with both pages. The framed pages (`canvas.html`, `pages/dock.html`, `pages/island.html`) carry `noindex`. There is no `robots.txt`: on a project site it would have to sit at the domain's root.

## The domain (insilode.dev)

The site is served from the root of https://insilode.dev through GitHub Pages with a custom domain. The build writes `CNAME` (the host of `SITE_URL`) into `dist/`, so a deploy never drops the domain, and every URL in the pages is relative, so the site also works under a sub-path. Owner's steps (nothing in the repository does them):
1. DNS at the registrar: the apex `insilode.dev` points at GitHub Pages (four `A` records, optionally the `AAAA` ones; see GitHub's "Managing a custom domain for your GitHub Pages site"). Verify the domain in GitHub (Settings, Pages) first, so nobody else can claim it.
2. Settings, Pages: custom domain `insilode.dev`, then Enforce HTTPS once the certificate is issued.
3. The old address `https://bothuany.github.io/axle/` is redirected to the domain by GitHub once the custom domain is set, and the repository `bothuany/axle` redirects to `bothuany/insilode` (never create a repository of the old name again: installed 0.4.x apps rely on that redirect).

To serve a fork or a preview from elsewhere set `SITE_URL` (the repository variable of the same name in the workflow, or the environment variable locally): `{{site}}` and the sitemap follow it, and `CNAME` is written only for hosts that are not `*.github.io`.

## Run it

```bash
(cd ui && npm ci)
(cd editor/extensions/flow-view && npm ci && node esbuild.mjs)
(cd editor/extensions/flow-harness && npm ci)
node scripts/site-data.mjs              # public/data and public/pages
cd site && npm ci
npm run typecheck && npm run build
npm run test:e2e                        # headless Chrome (CHROME_PATH if it is not found)
npm run preview                         # http://127.0.0.1:4173/insilode/
node scripts/capture-media.mjs          # with the preview running: the stills in public/media/
```

`npm run dev` serves it with hot reload (at `/`, not `/insilode/`). In Git Bash on Windows `/insilode/` in the preview script is rewritten to a path: run it from PowerShell or set `MSYS_NO_PATHCONV=1`.

## Capturing the theme again

`src/theme/vscode-theme.css` was captured from Insilode 0.3.1. To refresh it after a theme change, run `npm run web`, open the workbench and run this in the browser console, then keep the `--vscode-*` entries the file already has:

```js
const cs = getComputedStyle(document.querySelector('.monaco-workbench'))
copy(Object.fromEntries([...cs].filter(n => n.startsWith('--vscode-') && !n.startsWith('--vscode-icon-')).map(n => [n, cs.getPropertyValue(n).trim()])))
```

## Deploys

`.github/workflows/site.yml` builds, tests and deploys to GitHub Pages on every push to `main`. The repository owner enables it once: Settings, Pages, Source "GitHub Actions". `ci.yml` builds and tests it on pull requests too.
