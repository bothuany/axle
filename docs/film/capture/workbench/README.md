# Editor captures (film v3)

The stills of the window (`A1-editor` … `E-harness`, 3840x2160, the window at 2x) are made headless in web mode; no
window opens. Order:

1. Build the extensions and the canvas (`npm run build:extensions`, `npm run build:canvas`), then
   `node exts.mjs <work>`: copies them into `<work>/ext`, Insilode Dark included.
2. The demo repo: `site/demo/base` committed to its own git repo with LF line endings (Harbor Goods).
3. `node server.mjs <work> <demo repo>` (in the background) prints the URL; `node ../workbench-driver.mjs <url> <work>/wb`
   keeps one headless page open. In the driver, clear its `/oss-dev/` route first (`ctx.unrouteAll()`): this server is
   started with its own extensions folder, and the route breaks it.
4. Send the snippets with `node js.mjs <file.js>` (or `node js.mjs cmd "<palette title>" ["<pick>"]`):
   `settings.js` (Insilode Dark, bash terminal, no minimap), `gallery.js` (gives the web client the Open VSX gallery
   the product ships, `editor/patches/flow-core.patch`), trust the folder, `shots-a.js` (A1-A4), then
   `endpoints.js` and `b3.js` (B1-B3-sidebar: POST /orders picked in the Endpoints view, its flow tab, then the HTTP
   and topic hops expanded; fit the view after), then commit
   `docs/film/demo/changed` on the demo repo with author "Claude Code" and run `c.js`, `c4b.js` and `cde.js`
   (C1-C4, D-base, E-harness). Every snippet checks the theme before each still.

The dock in beat 06 is the dock page's live take (`../agents-live.mjs`, on the site's Try page), laid over the dock in
`D-base` by `tools/build.mjs`.
