# Captures

Headless Playwright scripts; none opens a window. They run where `playwright` resolves (a scratch
folder with `npm i playwright`), against:

- the built playground (`npm run build` in `playground/` after
  `PLAYGROUND_CHANGED=$PWD/docs/film/demo/changed node scripts/playground-data.mjs`, then
  `vite preview --base /axle/` from PowerShell): `canvas.mjs <base> <out>` (change set, order flow),
  `tour-and-agents.mjs` (the canvas's own tour, the agents tile), `island-and-dock.mjs` (the dock and
  island pages);
- the workbench in web mode (`npm run web -- <demo repo>`): `workbench-driver.mjs <url> <out>` keeps one
  page open and runs snippets sent to it over loopback.

The demo repo is `playground/demo/base` with `demo/changed/` committed on top, line endings LF.

Stills, captures and voice samples are review material and never go in the repo: they live in
`%LOCALAPPDATA%\Temp\axle-film-shots\`. `storyboard.html` reads its images from `storyboard/captures/`
(git-ignored); copy them there to view the sheet from the repo.
