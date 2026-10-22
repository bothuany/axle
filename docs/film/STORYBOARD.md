---
format: 1920x1080
duration: 62s
message: "Insilode is a code editor, built on VS Code, that shows how your code runs."
arc: Category first (the editor, 0-11 s) → what it adds, in the editor (canvas, change set, dock, harness map) → headline → one CTA
audience: developers who use VS Code (or a fork) and run Claude Code or Codex on real codebases
mode: collaborative
version: v3 (built; v2, the canvas-only film, is in git history)
---

# Launch film: storyboard v3

**Why a new film.** v2 lived on the canvas and never said what Insilode is. Every editor launch film we looked at
(Cursor, Zed, Void, VS Code) names the category in the first seconds and shows the real editor window early. v3 does
the same: the full editor is on screen from the first frame, and the first line says "code editor, built on VS Code".
Every feature after that is shown inside that window (a tab, a panel, the side bar), never as a floating card.

**Message.** Insilode is a code editor, built on VS Code, that shows how your code runs. Copy follows
[docs/design/messaging.md](../design/messaging.md): "code editor", "built on VS Code", "Open VSX"; never "all your
extensions", never an "Import from VS Code" button (not released).

**Format.** 1920×1080, 62 s, 30 fps. The window sits on the site's dark stage (`--film` #0c1020) with a 10 px radius
and the site's window edge, so the film and insilode.dev read as one thing. Captions in the band under the window
(one line, Archivo 40 px); when the camera pushes into the window they sit on a dark plate. A silent 15 s loop, a 1:1
and a 9:16 cut come from the same project; each beat names a focal region for the narrow cuts.

**One world.** One window for the whole film: the same Harbor Goods workspace, the same Explorer, the same Agents dock
on the right and the same tab strip. Every still is the same 3840×2160 capture of that window (1920×1080 CSS px at 2x),
so the camera is one transform over all of them: a cut between two stills reads as the UI changing in place.

**Truthfulness.** Every product frame is a headless capture of the real workbench in web mode (`npm run web` on the
film's build of this branch's extensions, Insilode Dark), on Harbor Goods (`site/demo/base`: orders and shipping in
Java, billing in Python). Nothing in the window is drawn for the film. Three things are prepared, and the film says so here:

- The agent's change is the film's prepared commit (`demo/changed/`, 14 files, +112 −16), committed with author
  "Claude Code"; no live Claude Code session runs (it would spend the user's quota). The terminal shows that commit with
  `git log`, and "Show Git Changes in Flow" → "Last commit" draws it.
- The Agents dock beat lays the dock page Insilode ships, recorded on the site's Try page with its scripted session
  (`capture/agents-live.mjs`: Codex needs an approval, Claude Code done, a second Claude Code working), exactly over the
  dock in the window's right side bar (same 380 px width, same 2x scale). In the real editor the dock shows real sessions.
- The Extensions view lists Open VSX: the web client is given the gallery configuration the product ships
  (`editor/patches/flow-core.patch`), since the dev checkout's `product.json` has none.

The film adds only the stage, camera moves, a few rings, captions, two labels and the end card.

## Brand

| Role | Value | Source |
|---|---|---|
| Stage | `#0c1020` | site `--film` |
| Window edge | `rgba(255,255,255,.09)`, radius 10 | site `--window-edge`, `--radius` |
| Text / muted | `#e9ecf5` / `#a9b1c9` | site `--ink`, `--ink-2` |
| Signal (rings, URL) | `#9aa8ff` on dark, button `#3f52c9` | site `--link`, `--signal` |
| Inside the window | Insilode Dark, as captured | the app |

Type: **Archivo** (variable, OFL; the site's face) 650 for statements, 500 for captions; **JetBrains Mono** for the URL.
Easing: `power2.inOut` for the camera, `power3.out` for type. No bounce, no glow, no gradient text.

## Script (voiceover and captions)

Written for speech: short sentences, contractions. The delivery is calm and conversational, not an announcer. The
picture is cut to fixed bar-line times (120 BPM, 2 s bars), not to a take. Voice (the user's pick after an audition of
Kokoro, Chatterbox, Chatterbox Turbo and Dia): Chatterbox (MIT), cloned from Karen Savage's public-domain LibriVox
reading, one seeded take per line (`vo/script.json`), every line transcript-checked, at 2.3-3.0 words/s and a median
pitch of about 195-230 Hz. "Insilode" is spelled "Insihlode" for the model; the transcriber hears it as "Insilode" in
line 08 and "Ensilode" in line 01.

| # | Time | Line |
|---|---|---|
| 01 | 0.5 | "Insilode is a code editor, built on VS Code." |
| 02 | 5.3 | "Your extensions, themes and keybindings work." |
| 03 | 11.3 | "Open an endpoint, and a tab shows how the request runs." |
| 04 | 17.3 | "Over HTTP into billing. Over Kafka into shipping." |
| 05a | 22.3 | "Now let Claude Code make a change." |
| 05b | 26.3 | "You don't get a wall of diffs. You see where it lands, on how the request runs." |
| 06 | 34.3 | "Run Claude Code and Codex side by side. The dock shows who's working, and who needs you." |
| 07 | 42.3 | "And the harness map shows what your agents load, and what to fix." |
| 08 | 48.5 | "Insilode. The code editor that shows how your code runs." |
| 09 | 55.2 | "It's free, and it's open source." (alternative take: "It's free, and the source is open.") |

About 105 words in 62 s. The name is in 01 and 08 only.

## Beats

### 01 The editor (0-5 s)
A1: the whole window. Explorer open on `orders-service`, `OrderController.java` in a tab (its `@PostMapping`
endpoints), the terminal with `git status`, the Agents dock on the right. Camera: the full window on the stage, a slow
push (1.00 → 1.04). Line 01. Focal (1:1, 9:16): the code tab and the Explorer.

### 02 What carries over (5-11 s)
A2 (5.0-7.6): the side bar switches to Extensions, `@popular` from **Open VSX** (Pyrefly, Python, Claude Code,
Red Hat Java, Go…); label "Extensions from Open VSX" at the side bar. A3 (7.6-9.4): `category:themes` (One Dark Pro,
Monokai Pro, Catppuccin…). A4 (9.4-11.0): the Keyboard Shortcuts editor. Camera drifts from the side bar to the centre.
Line 02. The note that a few Microsoft extensions are licensed for Microsoft's builds only stays on the site, next to
the full claim (the user's call); the film says only "from Open VSX". Focal: the side bar list.

### 03 Open an endpoint (11-17 s)
B1 (11.0-12.4): the endpoint picker ("Insilode: open an endpoint") with POST /orders selected. B2 (12.4-17): the
**Flow: Order.place** tab opens next to the code tab: controller → service → the `orders` table, BillingClient,
announce. Camera pushes into the canvas. Line 03. Focal: the picker, then the canvas.

### 04 Across services (17-22 s)
B3: the same tab with the cross-service hops expanded: `HTTP?` into billing's FastAPI `create_invoice` (Python) and
`topic?` into shipping's `OrderEvents.onOrderPlaced`. Camera pans right along the flow; a ring on each label as the line
names it. Line 04. Focal: the HTTP edge, then the topic edge.

### 05 An agent changes the code (22-34 s)
C1 (22.0-25.4): `OrderService.java` and the terminal: `8c37067 Claude Code: Add discount codes to orders` and
"14 files changed, 112 insertions(+), 16 deletions(-)". Camera on the terminal and the code. Line 05a.
C2 (25.4-26.4): "Show Changes in Flow" → "Last commit". C3 (26.4-29.6): the **Flow: Changes since HEAD~1** tab: the
root card "14 changed files · 10 endpoints", "Affects 10 endpoints", "Review 30 changes", the changed tables.
C4 (29.6-34): the same tab panned to POST /orders: `OrderService.place` with the removed line in red and
`applyDiscount` in green, the new `applyDiscount` card beside it. Line 05b. Focal: the commit line, the root card, the
green lines.

### 06 Agents side by side (34-42 s)
D: the same window, the change set in the editor; the Agents dock in the right side bar comes alive (Codex "Needs you ·
Approval: Run pytest", Claude Code "Done" with the endpoints its turn touched, a second Claude Code "Working"); the
avatars animate and switch to pixel pets at the end. Camera pushes from the window to the dock. Line 06. Focal: the dock.

### 07 The harness map (42-48 s)
E: the side bar switches to **Harness**: Map, Health 96, instructions, rules (one to fix: a rule that matches no file),
skills, subagents, hooks, MCP servers; `CLAUDE.md` in a tab. Camera on the side bar. Line 07. Focal: the map.

### 08 The headline (48-54 s)
B3 again, the whole window, quiet. "The code editor that shows how your code runs." in Archivo 650 under the window
(the site's headline). Line 08. No other motion but a slow pull back.

### 09 End card (54-62 s)
The window scales down and dims behind the lockup: the mark, **Insilode**, the headline, then "Download for Windows,
macOS, Linux", "insilode.dev · github.com/bothuany/insilode". Line 09. The window keeps drifting (the lockup lands on
moving footage); the last 1.5 s hold.

## Music and sound

Composed in code (`tools/score.py`), 120 BPM in A minor, so every cut sits on a bar line. A quiet pulse from the first
frame (the editor is calm, not a problem to solve), the arpeggio enters with the canvas (11 s), fullest under the agent
and the dock (22-42 s), thins for the harness, drops to the pad under the headline and resolves on a bell with the logo
(54 s). Ducked about 8 dB under the voice. Effects, synthesized: a soft tick on each side bar switch, a whoosh as a tab
opens, a pulse per cross-service ring, a two-note chime when the dock row needs you, one low hit on the logo.
Loudness about -14 LUFS, peaks under -1 dBTP.

## Cutdowns

- **15 s silent loop** (README, site hero): A1 (3 s, "A code editor, built on VS Code.") → B3 (4 s, "That shows how
  your code runs.") → C4 (4 s, "And where your agent's change lands.") → D (2.5 s) → A1 (1.5 s, "Insilode"). The last
  frame matches the first.
- **1:1 and 9:16:** the same timeline; the camera frames each beat's focal region; captions in the lower third.
- **Clips** (`docs/media/film/clips/`, silent 16:9, cut from the film): `editor.mp4` (01-02), `endpoint.mp4` (03-04),
  `change-set.mp4` (05), `agents.mp4` (06), `harness.mp4` (07), `loop-15s.mp4`. `tour.mp4`, `diagrams.mp4` and
  `across-services.mp4` (v2 beats) are removed; nothing in the repo or the site links them.

## Decided

- **Voice:** Chatterbox, Karen Savage reference (see Script). Kokoro (the v2 voice) and Dia were rejected by ear.
- **The Microsoft footnote** stays on the site, not in the film.
