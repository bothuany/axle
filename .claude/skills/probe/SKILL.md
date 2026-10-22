---
name: probe
description: Run Axle for real and probe a feature end to end in the built-in browser pane (web mode), without opening a desktop window - build, start `npm run web` on a demo or user project, trust the folder, drive the canvas, endpoints, callers and boards, and report what works with screenshot evidence. Use whenever the user asks to run, launch, try, smoke-test, "probe", demo or see a change working in Axle (e.g. "axle'ı çalıştır", "probe et", "uygulamada dene", "does the canvas show it"), or after a feature lands and tests alone don't prove it works in the app.
argument-hint: "[what to probe] [folder]"
---

# Probe Axle in the app

Unit tests prove the index and the canvas code; a probe proves a person would see it. Run the real editor, look at the feature, and report what you saw, not what the code should do.

## Ground rules

- **Don't take over the user's screen.** They often watch something while you work. Use web mode (`npm run web`) in the built-in browser pane (`mcp__Claude_Browser__*`), never `npm start` (an Electron window that grabs focus), and never global keyboard or mouse input (Windows-MCP, Claude in Chrome on their real browser). Keys and clicks inside the browser pane are fine: they go to that page only. If something truly needs the desktop window (the installer, an update, the status island, window focus or position), do not open one here: probe them in Docker: `npm run docker:e2e` runs the desktop scenarios and `npm run docker:e2e -- --probe <file>` runs your own Playwright script (test/e2e-desktop/lib/probe.mjs) in a container with a virtual display, screenshots in the output folder it prints. Windows-only checks (the installer, the update) go to `npm run sandbox:e2e` (Windows Sandbox). They never run in GitHub Actions. Docs: docs/building.md "Probing and testing the app without taking over your screen". Web mode runs headless and never brings a window to the front; the desktop e2e tests refuse to run unless `AXLE_E2E_ISOLATED=1`, which only the Docker entrypoint and the sandbox script set. Never set it yourself on the user's machine.
- **Probe what the user means.** `$ARGUMENTS` or the conversation says which feature (HTTP links, method-level impact, a board, the agents dock...). If unclear, probe the most recent change. Say which branch or commit you are probing: unmerged branches in other worktrees are not in this checkout.
- **Web mode serves webviews from the editor's origin** (docs/building.md), so only open the demo folder or the user's own code, never an untrusted folder.

## Steps

### 1. Build what you probe

From the repo root (each is seconds once `npm run setup` has run; never run setup yourself, it takes 10-20 minutes - if `editor/vscode` is missing, stop and say so):

```bash
npm run build:extensions
npm run build:canvas
```

### 2. Pick a folder

- Feature in the polyglot index or canvas: make the demo project. It is an Express backend, an axios/fetch frontend and a FastAPI service calling it, committed to its own git repo:

  ```bash
  node .claude/skills/probe/scripts/demo-workspace.mjs <scratchpad>/demo-shop
  ```

  If the feature needs code the demo lacks (a Kafka listener, a Go client, a C# controller), add a few files that exercise it to the demo folder before starting the server, and commit them there. Keep each file small and make every case you want to see distinct (different URL shapes, verbs, names).
- The user names a folder: use it as is, and do not edit their files.

### 3. Start web mode in the background and wait for the URL

```bash
npm run web -- <folder> > <scratchpad>/web.log 2>&1        # Bash, run_in_background
node .claude/skills/probe/scripts/wait-url.mjs <scratchpad>/web.log
```

The URL carries a fresh `?tkn=` token each start; open that exact URL. If port 8765 is taken (another probe still running), either reuse that server or start with `FLOW_PORT=8766`.

### 4. Open it and trust the folder

`mcp__Claude_Browser__preview_start` with the URL. Wait a few seconds for the workbench. A fresh folder opens in **Restricted Mode**, where Axle's extensions do not run: click "Restricted Mode" in the status bar, then **Trust**, then close the Workspace Trust tab.

### 5. Drive the feature

Prefer `read_page` / `find` for text and refs; use screenshots for the canvas (it is a webview, so its contents are pixels to you). Useful moves:

| To | Do |
|---|---|
| Open a file | `ctrl+p`, type the name, Enter |
| Go to a line | `ctrl+g`, type the number, Enter |
| Run an Axle command | `ctrl+shift+p`, type the title, Enter: "Show Flow at Cursor", "Open Endpoint Flow…", "Show Git Changes in Flow", "Show DTO Diagram", "Show Architecture Diagram", "Show Board…", "Home" |
| Give the canvas room | `ctrl+b` and `ctrl+alt+b` hide the side bars; close the code tab so the flow tab gets the full width |
| See every card | the fit-view button, bottom left of the canvas (the square under + and -) |
| Read a card or edge label | `computer` `zoom` on the region |
| Switch to who calls it | the **Callers** chip in the canvas header |

Keep the pane at its own size (`resize_window` preset `desktop`): a larger emulated viewport is scaled down until the text is unreadable.

What to look for, by area:

- **Flow canvas**: the expected cards in order, edges of the right kind (solid call, dashed `impl`, dashed animated `HTTP?` and `topic?` guesses, DB cards), each card's code.
- **Endpoints**: "Open Endpoint Flow…" lists every route once, and nothing that is not a route (a client call like `axios.post(url, body)` must not appear).
- **Callers / impact**: the Callers view and the "Affects N entry points" chip name the callers you expect, across files and services.
- **Agents dock, turn impact, Codex hooks**: these need a real Claude Code or Codex session that edits files. Starting one costs the user's quota and may need a login: ask before doing it, and never type credentials.

### 6. Check the noise

`read_console_messages` with `onlyErrors`. Known harmless in web mode: 404s for `vsda` (`vsda.js`, `vsda_bg.wasm`, a closed Microsoft module) and the dev product name "Code - OSS Dev" in some dialogs. Anything else - an extension activation error, a webview CSP violation, a failed request to the flow-view webview - is a finding.

### 7. Report

Lead with the verdict, then:

- **Works**: each check, with the concrete evidence (what card linked to what, the label you read).
- **Doesn't**: what you expected, what you saw, and the screenshot or console line.
- **Not probed**: what you skipped and why (needs a live agent, a login, an unmerged branch).

Say what you probed (branch or commit, folder). Reset any viewport you emulated. Leave the server running if the user may want to look, and say so (it is the background Bash task; stopping it ends the probe), otherwise stop it and close the pane tab.

## Desktop-only behaviour: probe in Docker

Web mode cannot show what only the desktop app does (the status island's second window, focus and window behaviour, first-run dialogs, native menus). Probe that in a container with a virtual display, so nothing opens on the user's machine:

1. Docker Desktop must be running in Linux-containers mode. The first run builds the image and the VS Code checkout (20 to 40 minutes, once); later runs take about 30 seconds. If it has never run here, say so and ask before starting a 30 minute build.
2. Write a probe script (start from `test/e2e-desktop/probes/hello.mjs`; keep yours in the scratchpad, not the repo):

   ```js
   import { startAxle, shot, runCommand, sleep } from '/work/axle/test/e2e-desktop/lib/probe.mjs'
   const { app, page } = await startAxle({ driver: true })   // driver: fake agents for the island
   await runCommand(page, 'Axle: Show Flow at Cursor')
   console.log(await shot(page, 'flow'))
   await app.close()
   ```

   `app.main(fn)` runs in Electron's main process (window bounds, visibility, focus); `app.overlayPage()` is the status island's page.
3. `npm run docker:e2e -- --probe <script> --out <folder in the scratchpad>`. It copies the working tree (uncommitted changes included) and rebuilds only what changed. Read the screenshots from the output folder; they stay out of the repository.
4. Report what you saw, with the screenshot paths. Docker is Linux: Windows-only checks (installer, update) go to `npm run sandbox:e2e`.
