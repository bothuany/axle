# Captures

Headless Playwright scripts; none opens a window. They run where `playwright` resolves (a scratch
folder with `npm i playwright`), against:

- the built playground (`npm run build` in `site/` after
  `DEMO_CHANGED=$PWD/docs/film/demo/changed node scripts/site-data.mjs`, then
  `vite preview` from PowerShell): `film.mjs <base> <out>` (the change set, the order flow, the canvas's own tour as a
  screencast, dock and island stills) and `agents-live.mjs <base> <out> [close]` (the dock and island pages recorded
  live, the avatar switched from gyro to pixel pets; `close` for the 7x close-up); `canvas.mjs`, `tour-and-agents.mjs`
  and `island-and-dock.mjs` are the storyboard's earlier single shots;
- the workbench in web mode (`npm run web -- <demo repo>`): `workbench-driver.mjs <url> <out>` keeps one
  page open and runs snippets sent to it over loopback; `mcp-call.mjs` calls the app's own MCP server like an agent
  (the skeleton-first board: `check_skeleton`, then `draw_board`).

The demo repo is `site/demo/base` with `demo/changed/` committed on top, line endings LF.

Stills, captures and voice samples are review material and never go in the repo: they live in
`%LOCALAPPDATA%\Temp\axle-film-shots\`. `storyboard.html` reads its images from `storyboard/captures/`
(git-ignored); copy them there to view the sheet from the repo.
