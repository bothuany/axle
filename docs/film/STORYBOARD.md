---
format: 1920x1080
duration: 80s
message: "Your agent changed the code. Insilode shows you where, on how it runs."
arc: Problem (hook) → Turn (the canvas answers) → Proof ×3 (tour, agents, diagrams) → Credibility → One CTA
audience: developers who run Claude Code or Codex on real codebases
mode: collaborative
version: v2 (built)
---

# Launch film: storyboard v2

**Message.** Your agent changed the code. Insilode shows you where, on how it runs.

**Audience and arc.** Developers who already let an agent edit their repo. Pain → turn → proof → lockup:
the hook asks a question every agent user has had, the canvas answers it, three features show the
rest of the loop, one call to action.

**Format.** 1920×1080, 80 s (target 60-90 s), 30 fps. English voiceover (local TTS), burned-in
captions in the bottom band (y 82-94 %), so key content stays in the top ~80 %. Music enters at the
turn, not before. A silent 15 s loop, a 1:1 and a 9:16 cut come from the same project.

**The spine: the fourteen files.** The hook shows the agent asking to edit them (the dock's approval
line), the diff lists them with nothing to say where they go, and at the turn the canvas's change set
answers with its own root card: "14 changed files · 9 endpoints". Every later beat happens on that
same canvas or beside it (one world), and the lockup lands over it.

**Why these three features.** The film answers one question ("where did my agent go?"), so the three
proofs are the three things you do next with an agent: understand a flow (the guided tour with the
ghost cursor), supervise the agents themselves (the dock and the island), and see the design
(diagrams from code). Skeleton-first, the harness map and in-app updates get a 6 s credibility
montage. The change set on the canvas is not one of the three: it is the turn itself.

**Truthfulness.** Every product frame is the app's own rendering, by its own code and CSS, captured
headless at 2x: the canvas (`ui/`), its tour, the Agents dock page and the status island page, run on
Harbor Goods (the playground's demo project: orders and shipping in Java, billing in Python) through
the playground's host (`site/canvas.html`, `scripts/site-data.mjs`), and the workbench in
web mode for the frames that need the whole window. The film adds only framing, camera moves, rings,
captions and type. The agent's change is a real commit for the film (`demo/changed/`, 14 files,
+112 −16), so the count, the diff and the green/red lines are real. The tour's steps are scripted, and the dock and the island are the app's own pages fed the playground's
scripted session. The question in 05 is asked in Insilode's own point-and-ask box (`ui/src/tour/PointAsk.tsx`).

## Brand (from the product)

Sampled from the captures (Insilode Dark), so the film's ground is the app's own:

| Role | Hex | Source |
|---|---|---|
| Ground (editor) | `#0f0f0f` | `--vscode-editor-background`, dock page |
| Canvas | `#1a1a1b` | canvas capture |
| Signal (the one accent) | `#6f86ff` | `--vscode-focusBorder`, the logo stroke |
| Button | `#5b72ff` | `--vscode-button-background` |
| Added / removed | `#5fe0a1` / `#ff6b7d` | change-set lines (only where code changed) |
| Needs you | amber of the dock's "Needs you" | dock attention only |

Two-color discipline: signal blue is Insilode; green and red appear only where code changed; amber only
where an agent needs you. Nothing else gets a color.

Type: **Instrument Sans** 600/700 for statements (tight tracking, -0.03 em, 96-150 px), 500 for
captions (44 px); **JetBrains Mono** only for real code, file names and the URL. Both OFL, embedded
from `assets/fonts/`. Easing: `power3.out` for arrivals, `power2.inOut` for camera moves,
`expo.out` for the chip flight; no bounce, no elastic.

## Bans

- No logo first. The logo appears once, at the end, over moving footage.
- No mock UI, no 3D device frames, no gradient blobs, no glow, no gradient text.
- No feature bullet lists on screen; one statement per beat at most.
- No fade-and-slide-up on every element; camera moves carry the motion.
- Slideshow failure: every beat a fresh card. Avoided by the one-world canvas.
- Screensaver failure: drifting decoration that says nothing. Avoided: every move pushes into a
  state change (a card lighting, the cursor arriving, a chip turning amber).
- No stock ukulele; no music under the hook.

**Held frame.** Beat 09: the canvas, all 14 marks on, nothing moves for 3 s while the line
"See how your code runs." lands.

## Product name

The name may change. It lives in one place, `brand.json` (`productName`, `spokenName`, `tagline`,
`repoUrl`, `download`); the root composition declares them as variables
(`data-composition-variables` in `index.html`) and every title, caption and the CTA bind to them
(`data-var-text`). The VO lines that say the name ("Insilode. Free and open source.") are generated from
`spokenName` and are re-generated once the name is decided. Nothing with the name is rendered until then.

## Changes from v1

Direction from the user: "uygulamamız zaten güzel gözüküyor, üretilen videoda uygulamadan doğrudan
olan görseller, CSS'ler kullanılmalıydı", and the product name may change.

- Every product frame is now a real capture (made by `capture/`, kept outside the repo), not a sketch. The film only adds
  framing, camera, rings, captions and type. The chip flight of v1 is dropped (it was film-made UI);
  the change set's own root card carries the count.
- 01: the hook sits beside the dock's real approval row ("Wants to: Editing main.py and models.py and
  service.py and…").
- 02: the real `git diff --stat` of the commit.
- 03-06: real canvas, change set, order flow, tour, dock and island.
- 07: a real board shown as a reference; recaptured on Harbor Goods in the build. 08: captures
  pending (the headless workbench comes up in the light default; being fixed).
- Palette re-sampled from the captures; the name is a token.
- The per-frame notes below keep their timing, VO and audio; where their visuals describe film-made UI
  (the chip flight, a rebuilt terminal), `storyboard.html` v2 is the plan.

## Changes after the first cut (user notes)

- "videonun sonunda eski repo adresi yazıyor": the URL is github.com/bothuany/insilode (brand.json).
- "40. saniyede animasyon yok agent simgesinde": the dock and the island are now recorded live
  (`capture/agents-live.mjs`), so the avatar animates; the hook uses the same take.
- "pixel seçeneği datlı bir şekilde gösterilsin": at 47–50 s a close-up on the dock's first row (the page at 7× zoom,
  not upscaled) shows the avatar switch from the gyro to the pixel cat with its "needs you" face; the island follows
  with the cat. New line 06c: "Or switch them to pixel pets." (the `flow.agents.avatar` setting's second value).
- "skeleton modundan da bahsedilsin": the montage opens on a real skeleton-first board, drawn through the app's MCP
  server (`check_skeleton`, then `draw_board`) with the types still MISSING, then the developer's save turns them
  MATCHES. Line 08: "Draw the skeleton, write it yourself, and hand it over. Your harness, scored."

## Script (voiceover, verbatim)

| # | Time | Line |
|---|---|---|
| 01 | 0.6-3.0 | "Your agent just changed fourteen files." |
| 01 | 4.3-4.7 | "Where?" |
| 02 | 6.6-9.2 | "A diff tells you which lines. Not what they reach." |
| 03 | 12.6-18.2 | "Now see the change on how your code runs: every endpoint it touches, cut down to the methods that changed." |
| 04 | 22.4-28.1 | "Across services and languages. From the controller, over HTTP and Kafka, to the table it writes." |
| 05 | 30.6-35.0 | "Ask how something works, and the agent walks you through it, on the real code, step by step." |
| 06 | 40.6-44.7 | "Run Claude Code and Codex side by side. See which one needs you, and why." |
| 06 | 50.4-52.3 | "Even when the editor is in the background." |
| 07 | 54.6-59.5 | "Sequence, ER and architecture diagrams, read straight from the code. Nothing invented." |
| 08 | 62.3-66.8 | "Every endpoint, one click away. Your harness, scored. Your tables, drawn." |
| 09 | 68.8-70.2 | "See how your code runs." |
| 10 | 74.2-76.6 | "{spokenName}. Free and open source." |

As built (final times from the generated lines; `vo/script.json` is the source). The name is said only in line 10.
Montage (08) as built: the Home page's endpoint list, its harness score, the ER board of the four tables.

About 125 words. Measured on this machine: Chatterbox speaks the hook line at ~3.2 words/s, Kokoro at
~2.5 words/s; at either rate every line ends before its beat does, and the times are re-cut to the
real VO after it is generated.

## Music and sound

- **Grid.** 120 BPM, one bar = 2 s; every beat boundary below sits on a bar line (0, 6, 12, 22, 30,
  40, 54, 62, 68, 72, 80), so cuts land on downbeats.
- **Bed.** Minimal electronic pulse: muted kick on 1 and 3, a soft synth bass, one bell-like
  motif that returns at the lockup. Silent under the hook (0-12 s): only room tone and UI sounds.
  The bed enters on the downbeat at 12.0 s, the moment Insilode appears. It drops to the bass alone under
  the held frame (68-72 s) and resolves on the logo at 74 s. Ducked about 8 dB under VO.
- **Source:** composed and synthesized in code (`tools/score.py`): kick, band-limited hats, a saw bass, a Karplus-Strong
  arpeggio, a detuned pad and an FM bell motif. No model and no samples, so there is no licence to clear.
- **Sound effects,** synthesized locally (no library licence), each tied to a real state change:
  key ticks under the terminal text (01); a dry "tick" per file name in the diff (02); a soft
  air-whoosh on the chip flight and a click per chip landing (03); a low pulse when a dashed
  HTTP/Kafka edge draws (04); a cursor glide and a page-flip tick per tour step (05); a two-note
  chime when a dock row turns amber "Needs approval", and the island's drop (06); a pencil scratch
  per diagram edge (07); three hard cuts on the downbeat (08); silence (09); one low hit on the logo
  (10).
- **Loudness.** Mix to about -14 LUFS integrated, peaks under -1 dBTP.

## Cutdowns

- **15 s silent loop** (README, site hero): 03 turn (chips land, 5 s) → 05 tour (cursor walks two
  cards, 5 s) → 06 dock row turns amber (3 s) → back to the canvas framing of the first frame (2 s),
  so the last frame matches the first. On-screen words carry it: "See what your agent changed." →
  "On how your code runs." → "Insilode". No captions, no VO.
- **1:1 and 9:16:** same compositions, re-framed per beat on the focal region named in each beat
  below; captions move to the lower third inside title-safe.
- **Per-feature clips** for the website (`docs/media/film/clips/`, silent, 16:9): `change-set.mp4`,
  `across-services.mp4`, `tour.mp4`, `agents.mp4`, `diagrams.mp4`, `loop-15s.mp4`.

## Decided (approved, v2)

- **Voice:** Kokoro-82M (Apache-2.0, https://huggingface.co/hexgrad/Kokoro-82M), British voice `bm_george`, run on
  this machine (`tools/vo-kokoro.mjs`). The name goes in as phonemes from `brand.json` so it is said IN-sih-lohd.
  Word times come from the local transcription model HyperFrames uses (NVIDIA Parakeet TDT 0.6B v3, CC BY 4.0).
  Rejected: F5-TTS (weights CC BY-NC 4.0). Chatterbox (MIT) takes stay possible with `tools/vo.py`.
- **Music:** composed and synthesized in code, no model (see *Music and sound*).
- **Agent sessions:** scripted: the playground's scripted session drives the app's real dock and island pages; no
  live Claude Code or Codex runs.
- **Hook:** "Your agent just changed fourteen files." The number is the real commit's (14 files).
- **Name:** Insilode, from `brand.json`; the URL on screen is the repository's, as a variable.

## Frame 01 — Hook (0.0–6.0, 6 s)

- scene: A Claude Code terminal finishes a turn; its last line reads "Updated 14 files". Big statement over it: "Your agent just changed 14 files." then "Where?"
- duration: 6s
- transition_in: cut
- voiceover: "Your agent just changed fourteen files." … "Where?"
- poster: 4.6
- focal: center, the statement (crops 1:1 and 9:16 safely)
- src: compositions/01-hook.html

On screen: the tail of a real Claude Code session in a terminal, dim (35 % opacity), scrolling up;
its last line "⏺ Updated 14 files" in the CLI's own styling. Over it, Instrument Sans 700, 120 px:
"Your agent just changed 14 files." At 4.2 s the sentence slides up and out; "Where?" (150 px)
holds alone for 1.4 s. **Motion:** the terminal types (first visible motion at 0.1 s); the
statement enters word by word on the VO (`power3.out`, 0.35 s). **Audio:** key ticks, no music.
**Seam out:** hard cut on "Where?"'s release. **No** logo, no music, no color but text and muted.
**Why:** the question the whole film answers.

## Frame 02 — The diff wall (6.0–12.0, 6 s)

- scene: The `git diff --stat` of the agent's commit: 14 file paths with +/- counts fill the frame, and slowly blur into an unreadable wall. (The paths and counts in the sketch are placeholders; the real commit's stat replaces them.)
- duration: 6s
- transition_in: cut
- voiceover: "A diff tells you which lines. Not what they reach."
- poster: 3
- focal: left column of paths
- src: compositions/02-diff.html

On screen: 14 paths in JetBrains Mono 34 px, `orders-service/src/main/java/…/OrderService.java | 12 ++++--`
style, green pluses and red minuses only in the counts. The camera drifts down the list
(`power2.inOut`, 6 s), and lines lose focus behind it. Each path becomes a chip outline at 11 s.
**Audio:** one dry tick per path as it appears. **Seam out:** the 14 paths shrink into 14 chips
(callback in 03). **No** red/green beyond the counts. **Why:** the honest status quo: a list of
lines with no shape.

## Frame 03 — The turn: the change on the flow (12.0–22.0, 10 s)

- scene: Insilode's canvas: POST /orders → OrderController.place → OrderService.place → BillingClient / OrderRepository / orders table. The 14 chips fly in and land on their cards; green and red lines light up inside the cards.
- duration: 10s
- transition_in: chips fly (continuous from 02)
- voiceover: "Insilode draws the change on how your code runs: every endpoint it touches, cut down to the methods that changed."
- poster: 7
- focal: OrderService.place card (center-left)
- src: compositions/03-turn.html

On screen: real capture of "Show Git Changes in Flow" on Harbor Goods: the Insilode window (workbench
chrome visible for the first 2 s, then the camera pushes into the canvas). The chips travel along
`expo.out` arcs (0.6 s, staggered 60 ms) to the cards; each landing lights a card's border in
signal blue and reveals its real diff lines (green added, red removed). At 18 s push in on
`OrderService.place`, where `applyDiscount(order)` is green and readable. **Audio:** the music
enters on the downbeat at 12.0; whoosh on the flight, a click per landing. **Seam out:** camera
pans right along the flow into 04 (rightward is the film's one direction). **No** invented cards: the
count and placement come from the capture. **Why:** the answer to "Where?".

## Frame 04 — Across services (22.0–30.0, 8 s)

- scene: The same canvas, panning right: a dashed animated "HTTP" edge from BillingClient.createInvoice into billing-service's FastAPI route (Python), a "topic" edge from order.placed into shipping's listener, and a database card for the orders table.
- duration: 8s
- transition_in: pan (continuous)
- voiceover: "Across services and languages. From the controller, over HTTP and Kafka, to the table it writes."
- poster: 5
- focal: the HTTP edge label, then the DB card
- src: compositions/04-across.html

On screen: real canvas, edges labelled as Insilode labels them ("HTTP", "topic"), the Python card's
code readable. A thin signal-blue highlight ring follows the edge being named by the VO
("HTTP" at 25.4 s, "Kafka" at 26.4 s, "table" at 28.2 s). **Audio:** a low pulse per edge. **Seam out:**
the ghost cursor enters from the right edge (continuity into 05). **No** extra labels over the UI.
**Why:** the flow is real across languages, which a diff never shows.

## Frame 05 — Proof 1: the guided tour (30.0–40.0, 10 s)

- scene: Insilode's ghost cursor walks the flow card by card; the tour caption ("Step 2 of 5 — the discount is applied before the order is saved…") and the tour bar sit on the canvas.
- duration: 10s
- transition_in: cursor enters (continuous)
- voiceover: "Ask how something works, and the agent walks you through it, on the real code, step by step."
- poster: 6
- focal: the cursor and its caption (move together; crop follows the cursor in 9:16)
- src: compositions/05-tour.html

On screen: the real tour player (`ui/src/tour`): ghost cursor, caption card, step counter, the line
highlight in the card. Three steps in 10 s: OrderController.place → OrderService.applyDiscount →
BillingClient.createInvoice. The camera follows the cursor with a slight lag (`power2.inOut`).
The tour starts from Insilode's point-and-ask box on the card ("how is a discount applied?"), the real
box `ui/src/tour/PointAsk.tsx` draws.
**Audio:** cursor glide, a tick per step. **Seam out:** the canvas slides left to make room for the
Agents dock (the window splits). **No** fake captions: the caption text is the tour's own.
**Why:** understanding a flow without reading ten files.

## Frame 06 — Proof 2: agents side by side, and the island (40.0–54.0, 14 s)

- scene: Insilode's Agents dock with a Claude Code row and a Codex row (model, context bar, cost, branch); the Codex row turns amber "Needs approval" with its text; then the window dims and the status island drops from the top edge with both agents' avatars.
- duration: 14s
- transition_in: split (continuous)
- voiceover: "Run Claude Code and Codex side by side. Insilode ranks who needs you, and why. Even when the editor is in the background."
- poster: 7
- focal: the amber row (40-50 s), then the island at top center (50-54 s)
- src: compositions/06-agents.html

On screen, two shots. **A (40-50 s):** the Insilode window with two terminals (Claude Code left, Codex
right) and the Agents dock on the side; at 45.8 s the Codex row jumps to the top, amber, "Needs
approval: run `npm test`?"; push in on that row. **B (50-54 s):** the window recedes to 60 % scale and
darkens; the status island (Insilode's own island page, captured headless) drops from the top edge,
showing "Claude · working" and "Codex · needs you". **Audio:** a two-note chime on the amber flip;
a soft drop on the island. **Seam out:** cut on the downbeat to 07. **No** OS chrome we cannot capture:
the island floats over the dimmed window, not over a desktop. **Why:** supervising the agents is the
other half of working with them.

## Frame 07 — Proof 3: diagrams from code (54.0–62.0, 8 s)

- scene: A board from code: a sequence diagram of POST /orders (Controller → Service → Billing → Kafka) assembling edge by edge; a quick cut to the ER diagram of orders/shipments.
- duration: 8s
- transition_in: cut
- voiceover: "Sequence, ER and architecture diagrams, read straight from the code. Nothing invented."
- poster: 4
- focal: the diagram's center
- src: compositions/07-diagrams.html

On screen: Insilode's board (real capture), recorded while it lays out. 54-58.5 s the sequence diagram;
58.5-62 s the ER diagram. Caption under the board's title: "from the index" (Insilode's own wording).
**Audio:** pencil scratch per edge. **Seam out:** hard cut on the downbeat. **No** hand-drawn
diagrams. **Why:** the design view, generated, so it cannot drift from the code.

## Frame 08 — Credibility montage (62.0–68.0, 6 s)

- scene: Three 2 s shots: a skeleton-first board with "Your turn: write these members"; the harness map with its health score; the gear's "Update available → Restart to Update".
- duration: 6s
- transition_in: cut
- voiceover: "Design the skeleton first. Keep your harness healthy. Update in place."
- poster: 1
- focal: each shot's one control
- src: compositions/08-montage.html

On screen: real captures, each pushed in on one control. If the update notification cannot be
captured headless, its shot becomes the harness map's lint list and the VO line changes to
"Lint it without an LLM." **Audio:** a hard cut sound on each downbeat. **Seam out:** cut back to the
canvas from 03 (callback). **No** feature list. **Why:** it is a whole editor, not a demo.

## Frame 09 — Held frame (68.0–72.0, 4 s)

- scene: The canvas from 03, wide, all 14 marks on. Nothing moves. "See how your code runs." in Instrument Sans 600 at lower left.
- duration: 4s
- transition_in: cut
- voiceover: "See how your code runs."
- poster: 2
- focal: whole canvas; the line at lower left (centered in 9:16)
- src: compositions/09-held.html

Callback to 03: the same framing, now quiet. **Audio:** the bed drops to bass. **Seam out:** the
canvas keeps its position; the logo lands over it in 10. **No** motion at all. **Why:** let the
answer land.

## Frame 10 — Lockup and CTA (72.0–80.0, 8 s)

- scene: The canvas slowly pulls back and darkens; the Insilode mark and "Insilode" land; under it "A harness-first code editor"; then "Download for Windows · macOS · Linux" and "github.com/bothuany/insilode".
- duration: 8s
- transition_in: continuous
- voiceover: "Insilode. Free and open source."
- poster: 5
- focal: center lockup
- src: compositions/10-cta.html

On screen: logo (from `editor/branding`) 180 px, the wordmark in Instrument Sans 700, tagline in 500
muted; at 75 s the download line and the URL in JetBrains Mono. The canvas keeps drifting behind at
20 % opacity (the logo lands in footage that is still moving). Last 1.5 s holds. **Audio:** one low
hit on the logo at 74.0, the motif resolves. **No** "Subscribe", no second CTA, no badges.
**Why:** one action.
