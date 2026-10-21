# Axle website: design direction (checkpoint 1)

Three directions for the new site at bothuany.github.io/axle, each with a token plan, wireframes for the hero and one problem
section at desktop and phone width, and the frontend-design skill's anti-default check. Each direction had a mock-up page and two
headless screenshots of it (1440 and 375); screenshots are kept out of the repository, so those were shown to the user separately.

The canvas in every mock-up was a real capture: `canvas.html` (Axle's canvas from `ui/` on the fake host) on the demo project's
data, screenshotted with headless Chrome. Nothing in the canvas was drawn by hand.
Every number in the copy comes from that data: the demo's agent change ("Claude Code: discount codes on orders") touches
2 files and reaches 4 endpoints.

## The brief, restated

- **Subject:** Axle, an open-source code editor (a VS Code fork) that shows how code runs, as a call-flow canvas, and keeps the agents
  that edit it (Claude Code, Codex, any CLI) visible and in check.
- **Audience:** developers who already work with coding agents and have felt "it changed something, where?".
- **Primary job:** download Axle for your OS. Second job: try the real canvas on this page, with a guided tour.
- **The subject's vernacular:** call chains drawn card by card, orthogonal edges with handle dots, entry points marked in amber,
  database cards in teal, added lines green and removed lines red, a ghost cursor that walks the flow. Those are the materials.

## Constraints every direction solves the same way

- **The hero is the real canvas in an iframe** of the canvas page (as today's `canvas.html`): the fake host already talks to
  `window.parent`, the canvas keeps its own Content-Security-Policy, and the iframe is created only when the hero is near the viewport,
  so Monaco and the 2.7 MB editor chunk never block the first paint. Until then a poster (a capture of the canvas) sits in its place,
  the same size, so nothing jumps.
- **No scroll trap.** The canvas does not take the wheel or one-finger touch while you scroll past it. On desktop a plain wheel
  scrolls the page, Ctrl/⌘ + wheel or a pinch zooms the canvas, and a drag pans it (the canvas gets `panOnScroll` off and
  `zoomOnScroll` gated by the page). On a phone the hero is the poster with a "Explore the flow" button that opens the canvas
  full screen with a close button; the page underneath never scrolls inside the canvas.
- **One button starts the tour** in the hero: the canvas's own tour player (`ui/src/tour`) plays a recorded tour of the
  POST /orders flow, with the ghost cursor, on the page.
- **The canvas keeps the product's own theme** (the captured `--vscode-*` variables): it is a window into the real app, so the page
  frames it rather than re-theming it.
- **Copy comes from the README and the demo data.** The headline is the README's line; problem sections use the README's
  four pillars, in the visitor's words.
- **Download:** the primary button names the visitor's OS ("Download for Windows", ".dmg for macOS", ".deb for Linux"), points
  at the latest release asset, and a small line under it lists the other platforms. GitHub is the second button, with the live
  star count from the GitHub API (the count is left out, not faked, if the request fails).
- **The name may change.** The product name lives in one constant in the build (title, meta, copy, alt text, the release
  asset patterns the download button matches), so a rename is a one-line change. The logo mark stays; no image carries a
  wordmark (the name next to the mark is live text), and the canvas captures contain no product name.
- **Try page:** `/try/` is a guided demo, not an IDE clone and not a tile wall: the canvas large, three stories to pick
  ("How an order is placed", "What the agent changed", "Where the message goes"), each a tour the ghost cursor plays, with
  Keep and Undo working on the agent's change. One story at a time, each a sequence, so its steps are numbered.

## Direction A: Light table (recommended)

A cool, pale page, like a drawing on a light table, with the dark canvas as the one lit window on it. A single trace,
drawn the way the canvas draws an edge (orthogonal, with a handle dot where it joins), leaves the hero canvas and runs down
the left gutter of the page; at each problem section it branches into that section, the way a call branches into the next card.
That trace is the page's one bold element; everything else is quiet.

**Colour**

| Name | Hex | Role |
|---|---|---|
| Film | `#E4E8EF` | the page: a cool grey-blue, not cream and not white |
| Ink | `#151B3B` | text and the logo's navy; real navy, not a tinted black |
| Signal | `#3F52C9` | links, the trace, the primary button (the logo's periwinkle, deepened to read on Film: 6.0:1) |
| Entry | `#A86A0A` | used only where the canvas means "entry point" (the trace's start, the "affects 4 endpoints" note) |
| Window | `#161616` | the canvas frame and the clip frames: the product's own canvas colour |
| Rule | `#C5CBD8` | the few lines the page needs (the trace's off-branches, input borders) |

Diff green and red appear only inside the canvas, where they mean added and removed.

**Type**

- Archivo, one variable family on two widths: headlines at width 125 and weight 650 (wide, like engraved lettering on a part),
  body at width 100 and weight 400. Scale 16 / 20 / 28 / 44 / 72 (ratio about 1.6 at display sizes), body 17px on 1.55.
- JetBrains Mono only where the page shows code or a command (file names, `npm run web`). Never for labels.
- Sentence case everywhere; no eyebrows above headlines.

**Layout:** left aligned on a 12-column grid with the trace in a 64px gutter; text sits in 6 columns, the canvas and clips take 8-10.

```
Desktop 1440                                                         Phone 375
+------------------------------------------------------------------+ +------------------------+
| [logo] Axle        Try it  Docs  Changelog     [GitHub ★ 3]       | | [logo] Axle     [☰]    |
|                                                                  | |                        |
| │  See how your code runs.                                       | | See how your           |
| │  Every editor shows where code is stored.                      | | code runs.             |
| │  Axle shows how it runs.                                       | | Every editor shows...  |
| │  [Download for Windows]  [GitHub ★]                            | | [Download for Windows] |
| │  Version 0.4.3. Also for macOS (Apple silicon, Intel), Linux  | | Other platforms        |
| │                                                                | |                        |
| ●──┬──────────────────────────────────────────────────────────┐  | | +--------------------+ |
| │  │ REAL CANVAS (iframe, POST /orders)                       │  | | | poster of canvas   | |
| │  │  controller ─ service ─ orders table / billing / kafka   │  | | | [Explore the flow] | |
| │  │                                  [▶ Play the tour]       │  | | +--------------------+ |
| │  └──────────────────────────────────────────────────────────┘  | | [▶ Play the tour]      |
| │   Drag to pan · Ctrl + scroll to zoom                          | |                        |
| ├──● Your agent changed 2 files.                                 | | │ Your agent changed   |
| │    Which endpoints did it reach?      +--------------------+   | | │ 2 files...           |
| │    text from the README (4 lines)     | clip: changes on   |   | | │ text                 |
| │    Show Git Changes in Flow           | the canvas (loop)  |   | | │ +------------------+ |
| │                                       +--------------------+   | | │ | clip             | |
| ├──● next problem ...                                            | | │ +------------------+ |
+------------------------------------------------------------------+ +------------------------+
```

On the phone the trace stays as a thin line at the left edge and the sections stack; the clip goes under the text.

**Anti-default check.** Closest cluster: 3, the broadsheet (light page, rules). It is not that: there are no hairline column
rules and no newspaper columns; the only line is the trace, which carries meaning (the page reads as a call flow), and product
surfaces keep the canvas's own 8px radius. It is not cluster 1 either: the page is cool grey-blue, the type is a wide grotesk, and
the accent is the logo's periwinkle, not terracotta. Changed while reviewing: the first plan used a white page with the
periwinkle as is (3.4:1, too weak for text, and every light SaaS page is white); it moved to Film and a deepened Signal.

## Direction B: The page is the canvas

The first screen is the canvas itself, edge to edge, like a whiteboard app whose home page is the app. The headline and the
download button sit in a card on the canvas, styled like one of the canvas's own cards, with an edge from it to the
entry point. Below the fold the page is the navy of the logo, with each problem section framed like a canvas group.

**Colour**

| Name | Hex | Role |
|---|---|---|
| Harbour | `#121633` | the page below the canvas: the logo's navy, clearly blue |
| Deck | `#1B2148` | section frames, raised areas |
| Paper | `#E6E9F7` | text |
| Haze | `#9097BD` | secondary text (7.1:1 on Harbour) |
| Signal | `#8C9CFF` | links, primary button, the edge from the headline card |
| Attention | `#F2B24C` | only for "needs you" (the agent waiting for approval) and entry points, as in the product |

**Type:** Schibsted Grotesk for everything (700 for headlines, 400 body), scale 16 / 21 / 30 / 48 / 80; JetBrains Mono only in code.

**Layout:** full-bleed canvas hero; below it, centred 1120px column, sections alternate text left and clip right.

```
Desktop 1440                                                         Phone 375
+------------------------------------------------------------------+ +------------------------+
| [logo] Axle                         Try it  Docs  [GitHub ★]      | | [logo] Axle    [GitHub]|
|..................................................................| |........................|
|.  +---------------------------+                                 .| |. +--------------------+.|
|.  | See how your code runs.   |●──────┐                          .| |. | See how your code  |.|
|.  | Every editor shows ...    |       │  REAL CANVAS, full bleed .| |. | runs. ...          |.|
|.  | [Download for Windows]    |       ▼                          .| |. | [Download]         |.|
|.  | [GitHub ★]  [▶ Play tour] |  controller ─ service ─ db ...   .| |. +--------------------+.|
|.  +---------------------------+                                 .| |. poster, tap to explore.|
|..................................................................| |........................|
|  Harbour navy                                                    | | Your agent changed     |
|  +-------------------------------------------------------------+ | | 2 files ...            |
|  | Your agent changed 2 files.     | clip                       | | | [clip]                 |
|  | Which endpoints did it reach?   |                            | | |                        |
|  +-------------------------------------------------------------+ | |                        |
+------------------------------------------------------------------+ +------------------------+
```

**Anti-default check.** Closest cluster: 2 (near-black with one acid accent). It is not that: the page is a saturated navy
(`#121633`), not a tinted black; the accents are the product's own semantics (periwinkle for the brand and links, amber only for
"entry point" and "needs you"), and there is no neon. Risk that remains: a dark dev-tool page is the expected look, so B depends on
the full-bleed canvas to stand out. The scroll trap is hardest here: the hero canvas needs the wheel-passes-through rule above.

## Direction C: Signal field

A loud, brand-owned first screen: the hero is a field of the logo's periwinkle with navy type set very large, and the
dark canvas window overlaps the field's lower edge into a calm, near-white page below. Bold once, at the top; the rest is plain.

**Colour**

| Name | Hex | Role |
|---|---|---|
| Field | `#6F86FF` | the hero background: the logo's periwinkle, exactly |
| Ink | `#0F1433` | type on the field (7.4:1) and on the page |
| Page | `#F5F6FA` | below the hero |
| Slate | `#4A5170` | secondary text on Page |
| Entry | `#F2B24C` | entry points and the tour button's play mark |
| Window | `#161616` | canvas and clip frames |

**Type:** Bricolage Grotesque at 800 for the one big headline (96px on desktop, set tight), Hanken Grotesk for everything else
(400/600, scale 16 / 20 / 26 / 40); JetBrains Mono only in code.

**Layout:** centred hero (the one place centring is used), then left-aligned sections in a 1120px column.

```
Desktop 1440                                                         Phone 375
+------------------------------------------------------------------+ +------------------------+
| ##### periwinkle field ########################################## | | ##### field ########## |
| # [logo] Axle                     Try it  Docs  [GitHub ★]      # | | # Axle      [GitHub] # |
| #                                                                # | | #                    # |
| #        See how your code runs.                                 # | | # See how your      # |
| #   Every editor shows where code is stored. Axle shows how...   # | | # code runs.        # |
| #        [Download for Windows]  [GitHub ★]                      # | | # [Download]        # |
| #   +--------------------------------------------------------+   # | | # +----------------+ # |
| ####| REAL CANVAS window, overlapping the field's edge        |#### | | ##| poster         |## |
|     |                                     [▶ Play the tour]   |     | |   +----------------+   |
|     +--------------------------------------------------------+     | |                        |
|  Your agent changed 2 files.             +----------------------+  | | Your agent changed ... |
|  Which endpoints did it reach?           | clip                 |  | | [clip]                 |
+------------------------------------------------------------------+ +------------------------+
```

**Anti-default check.** Closest cluster: 4 (SaaS kit, gradient washes). It is not that: the field is one flat brand colour, not a
gradient, and the page has no card grid. Risk that remains: a big centred headline over a colour field is a common launch-page
shape; what makes it Axle's is that the colour is the logo's and the canvas breaks the field's edge.

## Recommendation

**A, Light table.** It is the only direction where the page's own structure says what Axle does (the trace reads as a call flow
from the hero down through the problems), the dark canvas is the one lit thing on the page so the product is unmistakably the
hero, and it stays clear of the two looks a dev tool drifts to (dark with an accent, centred colour field). B's full-bleed idea
can still be borrowed for the Try page, where the canvas should fill the screen.

## Outcome

The user chose A. It is built in `site/` (see [site/README.md](../../../site/README.md)).
