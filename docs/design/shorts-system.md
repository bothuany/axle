# Shorts: the design system

A series of vertical short videos for YouTube Shorts, TikTok and Instagram Reels, made from real captures of Insilode, plus the HyperFrames templates that make a new episode a small data file. The project is in [docs/shorts](../shorts); this is the design that project implements. Copy and claims follow [messaging.md](messaging.md); the launch film ([docs/film](../film)) stays the long, voiced piece.

**The series is called "Dry Run".** A dry run is what the app lets you do: ask what an agent would be allowed to do, where a request would end up, what a change would reach, before anything happens. It is a developer's joke and the premise of every episode. Four things make an episode recognisable in its first second:

- the **hook as a question** in big type over the real UI already moving;
- the small **`demo project` chip** top left (it is also the honesty label);
- the **stamp** (ALLOW, ASK, DENY): a thud, a tilted mono word, a tally in the corner;
- a **pixel pet** (the Agents dock's real avatar) that peeks in at the very end, and sometimes talks.

These shorts are not launch videos. Nothing says "Introducing", no logo opens a video, no music sting. The product is the setting, the viewer's guess is the content.

## Hook craft rules

These are established short-form practice, written from experience. They are **not verified against a platform document**; treat them as house rules that we test and revise from the numbers on the first few posts.

1. **The first frame (0-1.5 s) is a question, a surprising claim or a visible problem in large text, over the real UI already doing something.** No logo, no title card, no "Introducing", no intro sting. In the templates the first frame is fully formed at t = 0: nothing animates in before it.
2. **Open a loop.** The viewer waits for the answer. The reveal comes at about 60-70% of the runtime, never at the end; the last 20-30% is the payoff and one line of consequence.
3. **One idea per video**, 12-25 s, beats of 1.5-3 s, at most 6-7 words of big text per beat, something visibly changes about every 2 s.
4. **The last frame is the first frame.** Every template ends (the last 2 s) by handing the picture back to its opening state, so a replay is seamless, and the quiet end tag lands on it. No download button, no "link in bio".
5. **Make the viewer do something in their head:** guess, predict, spot the difference, "would this be allowed?". A countdown ticks into the answer (3, 2, 1).
6. **Honesty** (below): real captures of the demo project, real numbers, staged things say "demo".
7. **Works muted.** The burned-in captions carry the story; sound is a light bed plus ticks, a thud on the reveal, a note per hop.

## Format

| | |
|---|---|
| Canvas | 1080 x 1920 px, 9:16 |
| Frame rate | 30 fps |
| Length | 12-30 s for a silent episode, aim for 15-20 s; **30-50 s for a voiced story** (see "Voiced stories" below). YouTube Shorts may be up to 3 minutes, vertical or square (official docs); we stay short because the hook and the loop are the format. |
| Codec of the delivered file | H.264 High, yuv420p, AAC 48 kHz, `-movflags +faststart`, about -16 to -14 LUFS, true peak under -1 dBFS |
| Audio | music bed + sound effects; a voiced story adds a voiceover (the bed ducks under it) |

### Safe margins

HyperFrames' preview draws two safe boxes (Premiere's defaults): **action-safe 90%** (5% inset on every edge) and **title-safe 80%** (10% inset). Captions and key content stay inside title-safe. On top of that, the platforms put their own interface over a vertical video: the caption and account block along the bottom, a column of buttons on the right edge, and the title or search bar at the top.

**No official pixel numbers for those were verified.** The margins below are conservative choices made for this series, not platform specs. The rule is the **stricter of the HyperFrames boxes and the platform guess**, per edge:

| Edge | Value on 1080 x 1920 | Why |
|---|---|---|
| Top | 192 px (10%) | title-safe, and room for the platform's top bar |
| Bottom | text stops at **1459 px** (24% = 461 px kept clear) | the caption block and the progress bar of the platforms cover roughly the bottom 20-25%; title-safe alone (1728) would put captions under it |
| Left | 108 px (10%) | title-safe is stricter than the 8% first guess |
| Right | 972 px (10%) above 1056 px; **907 px** below it | title-safe, plus an extra 6% (65 px) in the lower half, where the like/comment/share column sits |

Pictures of the real UI are not text: they may use the action-safe width (54 px in, 972 px wide) and end at 1290 px, but nothing the viewer must read sits in the clear bands. The tokens are in [brand.css](../shorts/assets/brand.css) (`--tx0`, `--tx1`, `--tx1-top`, `--ty0`, `--ty1`, `--px`, `--pw`). The contact sheet with the margins drawn on a second copy is how to check a new template; the overlay is drawn on stills afterwards, never inside a composition (Studio draws its own, and a guide inside the HTML would render).

### The grid

```
y    0 ┌────────────────────────────┐
       │  top band: nothing         │
  192  ├─ demo project chip ── tally ┤  28 px mono
  250  │  QUESTION / BEAT TEXT       │  84-100 px, weight 650, 2-3 lines
  ~600 ├────────────────────────────┤
       │  PICTURE: the real UI       │  x 54-1026, radius 28, camera inside
       │  (A 690 high, B 2 x ~400,   │
       │   C 590, D 650, E 810)      │
 1290  ├────────────────────────────┤
 1340  │  CAPTIONS (burned in)       │  56 px, 2 lines max, x 108-907
 1450  ├────────────────────────────┤
 1459  │  bottom 24%: platform UI    │
 1920  └────────────────────────────┘
```

## Tokens

Dark only. The values are the site's (`site/src/site.css`).

| Token | Value | Use |
|---|---|---|
| `--bg` | `#0c1020` | the stage |
| `--bg-2` | `#182036` | top of the stage gradient |
| `--surface` | `#121830` | chips, cards |
| `--ink` | `#e9ecf5` | text |
| `--ink-2` | `#a9b1c9` | secondary text |
| `--signal` | `#3f52c9` | reserved (the site's button blue; not used on a video) |
| `--accent` | `#9aa8ff` | the key word, links, the address (8.5:1 on `--bg`) |
| `--entry` | `#e3a23b` | the demo chip's dot, ASK, "what git says" |
| `--added` | `#5fe0a1` | ALLOW, green |
| `--removed` | `#ff6b7d` | DENY, red |
| `--rule` | `#2a3352` | borders, the empty slot |

Type: **Instrument Sans** (headings and captions, weight **650**, tracking -0.028em on headlines, -0.02em on captions) and **JetBrains Mono** (commands, numbers, chips, the stamp, the clock). Both are OFL, self-hosted: the variable `wght` latin files from the Fontsource packages the site uses (`@fontsource-variable/instrument-sans`, `@fontsource-variable/jetbrains-mono`) are in `docs/shorts/assets/fonts` with their licences. No CDN for type. Sizes: headline 84-100, beat text 92, captions 56, command 46, chips 28-32, stamp 124. **Nothing readable is under 28 px**: HyperFrames' check flags it, and it is what a phone can read.

Say "code editor" and "built on VS Code" (the end tag does, in every episode); say Open VSX, never "all your extensions"; never "IDE"; the vocabulary table in [messaging.md](messaging.md) applies. Extensions and the import are **not** subjects of this series for now.

## Templates

Every template is a sub-composition in `docs/shorts/compositions/`, parameterised by composition variables. An episode is a JSON file in `docs/shorts/episodes/`; `tools/episode.mjs` turns it into a project (hosts, variables, captions, audio) and the templates do the rest. One caption host, one element kind per track, every scene a sub-composition, as the HyperFrames Studio conventions ask.

| | Template | Carries | Variables (besides `question`, `duration`, `loop`) |
|---|---|---|---|
| **A** | **Question over live UI** | a question, a real capture with a slow push, optional rings and countdown, the answer on a plate that rises from the picture's bottom edge | `capture`, `cam`, `rings`, `countdown {t,n,step}`, `answerAt`, `answerKind`, `answer` |
| **B** | **Spot the difference** | two stacked captures: "what you usually get" on top, an empty `?` slot below that the second capture fills at the reveal, coming up through the bottom edge | `captureTop`, `camTop`, `labelTop`, `captureBottom`, `camBottom`, `labelBottom`, `rings`, `revealAt` |
| **C** | **Verdict rounds** (ALLOW or DENY?) | up to 4 rounds: a command in a card, 3-2-1, the real permission simulator's answer swapped in place, a stamp, a tally | `rounds [{shown, result allow/ask/deny, t, reveal, empty, verdict}]`, `cam` |
| **D** | **Case file** | short text beats (detective, deadpan list, agent court) over ONE capture; a beat of kind `bubble` is a pet talking | `beats [{t, d, text, kind line/reveal/bubble, who cat/codex}]`, `capture`, `cam`, `rings` |
| **E** | **Ride** | the camera rides the real flow, a chip lands per hop, a note per hop, an optional clock | `capture`, `cam` (the ride), `hops [{t, label, ring}]`, `timer` (label of the clock, empty for none) |

A release note is template D with a version chip as its first beat and three line beats (one bullet each); no release note is in the first series.

**Elements** that make the formats possible: the **stamp** (`.stamp.allow|ask|deny`, mono 700, 12 px border, tilted -7 degrees, lands in 0.14 s with a short shake, the `thud` sound); the **tally** (`ALLOW 1 · ASK 0 · DENY 1`, one state per round answered); the **countdown** (a big mono digit, swapped hard each 0.8 s, a tick each); the **plate** (answer card); the **speech bubble** with a **pet cameo** (the dock's real pixel avatars, cut from the dock page's live take by `tools/setup.mjs`, enlarged without smoothing); the **clock** (the video's own time, always labelled, see honesty); the **ring** (a box on the real UI at a moment, the film's device); the **chip** (mono label).

**Camera.** A key is `{t, cx, cy, w}`: the point of the window (fractions of the 3840 x 2160 capture) at the picture's centre, and the share of the window's width shown. The camera always covers the picture (it never shows an empty edge) and moves between keys with `power2.inOut`. Frame the UI so its text is at least about 22 px in the 1080-wide frame: a window width `w` of 0.2-0.3 for a 972 px picture. To change what the UI shows (a result appears), swap to the second capture of the same framing in place; the camera does not move.

**The loop and the end tag.** The last `loop` seconds (default 2) return the template to its first frame (a hard cut back for C, a ride back for the others, items leaving through the picture's own edge), and `compositions/tag.html` lands on it: the app mark, `insilode.dev`, "Free and open source", "A code editor, built on VS Code", and the pet bobbing once. It holds 2 s. It is not a button and asks nothing. The start of the video is therefore the same picture as the end.

## Captions

Burned in, Instrument Sans 650, 56 px, **at most 2 lines**, left-aligned in x 108-907, on a dark plate (`rgba(12,16,32,.88)`) so they stay readable over any UI; the key word in the accent colour (`*word*` in the data), one key word per caption. **Word-timed**: each word comes in on its own beat (spread over the first 70% of the group, or given as `words: [seconds]` for a voiced take). A group stays long enough to read (about 0.35 s per word, never under 1.4 s) and ends before the next starts. Captions sit in the band under the picture, never on it, so they never cover the UI; if a template puts a caption over a capture the plate stays. They carry the story, the big text above carries the hook: do not repeat one in the other.

## Motion rules

- **One idea per beat**, 2-3 s per beat; the question is on screen from frame 0.
- **The camera pushes into real UI**, slowly, over the whole beat; it never cuts to a different part of the screen without moving there.
- **Cursors and scrolled content leave through the frame edge** (or the picture's edge), they do not fade out mid-frame. The same goes for a plate, a chip, a bubble, a second picture: they come up through an edge and leave through it, and text lines rise into and leave through their own clip box.
- **No fade mid-frame, no dissolve between beats.** A swap of state is a hard swap on a beat.
- **Nothing persisting jumps between cuts**: the demo chip, the question, the picture's frame and the camera continue across a swap of captures.
- Easing: `power3.out` entering, `power2.in` leaving, `power2.inOut` for the camera, `sine.inOut` for a ride; no bounce, no glow, no gradient text.
- **No strobe**: no element changes brightness or colour more than 3 times in a second; the stamp's shake is 4 px and lasts 0.2 s.

## Audio

- **Music bed composed in code** (`tools/score.py`: NumPy, no model, no samples; the short version of [docs/film/tools/score.py](../film/tools/score.py)): A minor, pad, a plucked arpeggio and a bass pulse at 84-96 BPM. It is already moving at frame 0 (no sting). In the 2.4 s before a reveal it thins to the pad (the guess) and the arpeggio comes back with the reveal.
- **Ducked under the voice** if there is one: -9 dB while the voice speaks, held across pauses up to 0.9 s so the bed does not pump between words, 0.12 s down ahead of a word and 0.5 s back up after a phrase. Measured on episode 02's real voice track: the bed sits 9.0 dB under its undocked level inside every line, with no recovery inside a line. A silent episode measures about -17 LUFS (bed plus effects); the phone copy is checked with `ebur128`.
- **Captions-first**: every video works muted. The sound adds, it never explains.
- **Voice.** The silent quiz episodes have none. A **voiced story** (below) is narrated by the launch film's voice: Chatterbox run locally, conditioned on the public-domain LibriVox reading the film uses (Karen Savage, "Pride and Prejudice" v3), the "04 female" take of the film's voice audition; a second character may use the model's built-in voice with no reference. `tools/vo.mjs` makes the takes and places them; the episode's `vo` block holds the lines, and the bed ducks under the result. (The first draft of this document said the shorts would not reuse a cloned voice; the user picked the film's voice for the shorts on 2026-10-23.)
- **Sound effects** (synthesized in `score.py`), one per UI action: `tick` (countdown, beat), `type` (a typed character), `thud` (DENY), `ok` (ALLOW, two rising bells), `ask` (ASK, two equal bells), `note` (a hop, pentatonic, rising), `pop` (a reveal), `whoosh` (a second picture arriving). `tools/episode.mjs` writes them from the template's data (the stamp times, the hop times); an episode can add its own under `sfx`.
- **AI disclosure.** If a voice is used (a synthetic voice), say so in the description: "Voice: synthetic (AI-generated)". Platforms also have their own label setting for synthetic content; set it. The silent quiz episodes have no voice, music and effects are composed in code, and the pictures are real captures: nothing needs the label, and the description still says "Music composed in code". Every voiced story carries the line and the label.

## Honesty

- Pictures are **real captures of the app on the demo project** (Harbor Goods, `site/demo/base`), never mock-ups. The description says **"demo project"** and the chip says it on the video.
- **Numbers on screen are values from the capture** (14 files, 10 endpoints, 4 endpoints, 2.8k tokens, ALLOW/ASK/DENY words and rules). A number is checked against the capture before it goes in a caption.
- **Staged things say so.** The agent's commit in the case episodes is the film's prepared commit (`docs/film/demo/changed`, authored "Claude Code"), not a live session. No invented incidents or testimonials ("I asked Claude and it broke prod") unless shown and labelled as a staged demo. A joke is a joke: the pet's bubble is a character, not a quote.
- **Camera moves and graphics are ours** (stamp, rings, tally, chips, clock); the picture under them is untouched. The clock in E is the **video's clock** and its label says so; it is not a measurement of the app.
- **The verdicts are the simulator's own.** The simulator is an approximation; the episode does not claim an agent will behave exactly so. Say "the permission simulator says".

## Accessibility

- Contrast: every text/background pair on a video is AA or better (`accent` is 8.5:1 on `bg`; `ink-2` is for small secondary text only). `hyperframes check` runs the contrast audit on the rendered frames (all text checks pass for the examples).
- Captions always sit on a plate; text over UI always has one.
- No strobe (above), no flashing full-frame changes, the countdown swaps at 0.8 s.
- Minimum type 28 px; the key information is never colour alone (ALLOW/ASK/DENY are words as well as colours).
- Muted works; the video also makes sense without the pictures' small text because the question, the stamp and the captions carry it.

## Files, naming, checklist

```
docs/shorts/
  index.html                  the committed example (episode 01, built with --here)
  hyperframes.json
  assets/brand.css, shorts.js tokens and the shared helpers (camera, text, countdown)
  assets/fonts/               Instrument Sans + JetBrains Mono (variable, latin) and their OFL texts
  compositions/               tpl-a..tpl-e, captions, tag; story-chaos, story-flow, story-end (the voiced story's scenes)
  episodes/NN-slug.json       the data: one file per episode
  tools/setup.mjs             captures -> JPEG, pets, icon (works files, git-ignored)
  tools/vo.mjs, vo.py         a voiced episode's lines -> work/<id>/voice.wav and the word times (Chatterbox, local)
  tools/episode.mjs           episode data -> a project in build/<id>/ (or --here)
  tools/score.py              the bed and the effects, composed in code; the duck under the voice
  tools/deliver.mjs           render -> the delivered file, the phone copy (-15 LUFS) and a contact sheet
```

- **Naming:** `NN-slug` (`01-allow-or-deny`): two-digit order, a short slug; the same name for the data file, the project folder, the render (`renders/NN-slug.mp4`) and the phone copy (`NN-slug-phone.mp4`). Captures keep the film's names (`B3-sidebar`, `C3-changes`); new ones are named for what they show (`P2-sim-verdict`, `Q1-empty`).
- **New episode:** copy the closest `episodes/*.json`, change the text, the capture names, the times and the camera keys; `node tools/episode.mjs episodes/NN-slug.json`; check, snapshot, render.

**Setup (once per clone):** `node tools/setup.mjs` (needs `ffmpeg`; the capture dirs default to the film's `insilode-film-v3\wb` and `insilode-shorts\wb-new` under `%LOCALAPPDATA%\Temp`, or pass dirs; `--dock <dock-live.mp4>` for the pets), and Python with NumPy for `score.py`. Captures, pets, audio and renders are working material and stay out of git.

**Render checklist**

1. `node tools/episode.mjs episodes/NN-slug.json` (into `build/<id>`).
2. In the build folder: `npx hyperframes check` passes (warnings read, the type floor and the closing-line hold are the ones to respect).
3. `npx hyperframes snapshot --at <t of each beat, the reveal, the loop frame>`; look at every frame: nothing cropped, nothing under 28 px, the stamp and the captions inside the margins, the last frame equals the first plus the tag.
4. Numbers on screen match the capture. "demo project" is on screen and in the description.
5. `npx hyperframes render --output renders/NN-slug.mp4 --fps 30`.
6. The phone copy: `ffmpeg -i in.mp4 -c:v libx264 -preset slow -crf 20 -profile:v high -pix_fmt yuv420p -r 30 -c:a aac -b:a 160k -ar 48000 -movflags +faststart out.mp4`; `ffprobe` shows yuv420p and the `moov` atom before `mdat`; loudness about -17 to -14 LUFS, peak under -1 dBFS.
7. Watch it once muted and once with sound, on a phone if possible.
8. Description and hashtags (below); the disclosure line if there is a synthetic voice.

## First series: "Dry Run", 8 episodes

Each episode: a working title, the hook (with two alternatives to pick from), the joke or twist, the reveal beat, the capture and template, the sound idea, the one-sentence consequence. "Have" means the capture exists; "need" means it must be captured first (headless, `docs/film/capture`). Episodes 1-4 and 6 have an example file in `episodes/` (the example for template D is episode 3, for B episode 4, for E episode 2, for A episode 6). The hook lines were not tested on an audience.

| # | Working title | Hook (alternatives) | Template | Capture |
|---|---|---|---|---|
| 1 | **ALLOW or DENY?** | "Would your agent run this?" (a) "Three commands. You guess." (b) "Guess before the stamp." | C | have: `P5/P6`, `Q1`, `P1/P2`; more rounds `Q2` (curl \| sh), `Q3` (Read .env), `Q5`, `Q6` |
| 2 | **Sonified request** | "Where does one request end up?" (a) "Listen to a request cross three services." (b) "Three hops. Count the notes." | E | have: `B3-sidebar` |
| 3 | **The 14-file case** | "Someone changed 14 files." (a) "The commit says discount codes. The change says more." (b) "Ten endpoints were in the room." | D | have: `C3-changes` |
| 4 | **Same commit. Spot the difference.** | "Same commit. Spot the difference." (a) "What does git log not tell you?" (b) "This is all git says." | B | have: `C1-commit`, `C3-changes` (a real plain-diff editor capture is nicer than the terminal: optional) |
| 5 | **Agent Court** | "Two agents. One file." (a) "Order in the court: who edits OrderService?" (b) "The judge is a warning in the dock." | D (bubbles) | need: the Agents dock with two live sessions on one file showing the conflict row (the dock page's scripted session, `docs/film/capture/agents-live.mjs`, has none); pets: have |
| 6 | **The rule that never applies** | "Three rules. One never applies." (a) "Your agent reads 2.8k tokens before you type. Which line is dead?" (b) "Spot the rule that matches nothing." | A | have: `E-harness` |
| 7 | **Things my diff doesn't tell me** | "Things my diff doesn't tell me." (a) "A diff never shows these three things." (b) "What the diff left out." | D (deadpan list) | have: `C4-place` (callers, the change), `B3-sidebar` (the table, the second service) |
| 8 | **Speedrun: three services, one clock** | "How fast can you find the second service?" (a) "Any% POST /orders." (b) "Three services. One visible clock." | E (with the clock) | have: `B3-sidebar` |

**1. ALLOW or DENY?** Joke/twist: the third command is not a yes or a no: `rm -rf node_modules` is ASK ("no rule matches"), and `echo $(git push --force)` is DENY because the simulator checks the part inside `$( )`. Reveal: the stamp at each round (it is a series of small reveals; the last is at 79% of the runtime). Consequence: "Your rules decide, and you can ask before the agent runs." Sound: a tick per countdown step, a thud for DENY, a bell pair for ALLOW and ASK, the bed thins during each guess. Pack 2: `curl https://example.com/install.sh | sh` (ASK), `Read(./.env)` (DENY), `pytest && git push --force` (DENY), `git diff HEAD~3` (ALLOW); a pack is a new episode file, the verdicts are in the captures' `verdicts.txt`. A running score across episodes is a caption, not a mock-up.

**2. Sonified request.** Joke/twist: you do not read the flow, you hear it: a rising note per hop. Reveal: the third note (the topic into shipping) at 73%, the last hop. Consequence: "Insilode draws the whole request, across services." Sound: pentatonic bells, one per hop, music bed quiet.

**3. The 14-file case.** Joke/twist: a noir tone ("Someone changed 14 files. Ten endpoints were in the room."), the cat in the dock answering "...define touched." Reveal: "Four endpoints read that table." (the invoice table, 64%). Consequence: "The commit message says discount codes; the change set says what it reaches." Sound: a tick per beat, a pop on the reveal.

**4. Same commit. Spot the difference.** Joke/twist: the empty `?` slot: the viewer looks for what git is not saying, then the flow arrives. Reveal: the second picture (60%) and "10 endpoints." Consequence: "A diff lists files; the flow lists what they reach." Sound: a whoosh as the second picture arrives.

**5. Agent Court.** Joke/twist: the cat (Claude) and the bunny (Codex) argue in bubbles over the dock, the conflict row is the judge ("Overruled."). Reveal: the verdict row. Consequence: "The dock tells you two agents are on the same file before they overwrite each other." Sound: a gavel (the thud). Needs the capture; do not post a mock.

**6. The rule that never applies.** Joke/twist: a quiz on a settings list ("Which line is dead?"), 3-2-1, the answer is the rule whose pattern matches no file. Reveal: the plate at 61% of the runtime, after the 3-2-1. Consequence: "The harness map says which rule your agent never gets." Sound: ticks, a pop.

**7. Things my diff doesn't tell me.** Joke/twist: a deadpan numbered list of three, no hurry, the third is the best ("A second service."). Reveal: item 3. Consequence: "Callers, the table behind the query and the other service are on the flow, not in the diff." Sound: a tick per item, a pop on the third.

**8. Speedrun.** Joke/twist: a speedrun with a visible clock and "splits" (hops), tone of a game; the clock is labelled "video clock", the joke being that a human finds the second service in about 8 seconds on a canvas. Reveal: the third split. Consequence: "You can find where a request goes without reading the code." Sound: a rising note per split.

**More ideas, held back:** "The bug wasn't in the code, it was a table" (needs a table-impact capture), "Which agent needs me?" (the dock page's live take: Codex needs approval, one Claude Code done, one working; the capture exists), "Would this survive a rename?" (callers on the canvas).

### Cadence

Pre-render a batch of **6**, post **1-2 per week**: the batch is 1, 3, 2, 6, 4, 7; keep 5 and 8 until their captures (5) and a second look (8). Order inside the batch alternates the format (a quiz, a story, a visual) so two neighbours never look the same. Post by hand or through Postiz; the file names and the descriptions are in the episode data.

### Description and hashtag pattern

```
<The hook question, as the first line>
<One sentence: what it shows and the answer's headline, no spoiler if the reveal is the point.>
Demo project (Harbor Goods). Real captures of Insilode, a code editor built on VS Code. <Staged, if it is: "The commit is staged for the demo.">
Music composed in code. <Voice: synthetic (AI-generated), only if there is a voice.>
Free and open source: insilode.dev
#dryrun #claudecode #codeeditor #devtools  (+ one topic tag: #git, #backend, #aiagents)
```

Three to five tags, the series tag first. The hook line is also the title on YouTube. Do not use "IDE", "all your extensions" or a Microsoft endorsement; "built on VS Code" yes.

## Voiced stories (2026-10-23)

The first test (episode 1, ALLOW or DENY) was "fine but not fun enough": the quiz did not grab, and a silent cut with music felt flat. The direction from that feedback: **someone talks**, the video is about a **real need** a developer has lived, something **funny** happens on the way, and it tells a **small story** that ends on the call-flow canvas. Flow ("how your code runs") is the priority subject; the ALLOW/DENY episode stays as a lower-priority extra and is not built on.

**The format.** 30-50 s, voiced, word-timed captions from the voice (one caption track, muted-first), the music ducked under the voice.

1. **The pain** in the first 1-2 s: a line a developer has actually said, over the real editor.
2. **The comic turn**, escalating: drawn graphics (paper tabs, sticky notes, red string, the pixel pet reacting). Drawn things look drawn (paper, cork, string); they never imitate Insilode's UI.
3. **The reveal from real captures**, in one or two plain sentences: what the canvas shows and why it helps.
4. **The loop**: the last frame hands back to the first; the end tag lands on it.

Every voiced episode's description says "Voice: synthetic (AI-generated)", and the platform's synthetic-content label is set.

**How it is built.** An episode with `scenes` (instead of one `template`) puts several scene compositions on one timeline, each with its own start; an episode with a `vo` block is voiced: `node tools/vo.mjs episodes/<id>.json` makes one take per line with the local Chatterbox model (`tools/vo.py`, run with the Chatterbox venv; `INSILODE_TTS_PYTHON` names its python), trims it, stretches it to the line's `tempo`, normalizes it and transcribes it for its word times, then places every line at its `t` in one 48 kHz voice track (`work/<id>/voice.wav`, git-ignored). `tools/episode.mjs` turns the placed words into the caption groups (at most 6 words each, the line's `*starred*` word in the accent colour) and ducks the bed under the voice.

### Three pitches

**A. The conspiracy board** (built: [episodes/02-flow-conspiracy-board.json](../shorts/episodes/02-flow-conspiracy-board.json))

- Hook: "Day three at a new job. One ticket: what happens when someone places an order?"
- Beats: the real editor on `@PostMapping("/orders")` → Ctrl+Click, Ctrl+Click: paper tabs pile up over the editor, one per real file of the request (OrderController, OrderService, OrderRepository, Order, BillingClient, then `main.py`: "wait, why is it Python now?", then OrderEvents) → "It sends a string into Kafka. Who listens to a string?" → a cork board with the tabs pinned and red string between them, the cat peeks at it → a coworker (second voice): "Hey. Are you okay?" "I'm fine. It's all connected." → "And it is." The cards snap into the layout of the flow and the board becomes the real canvas → the camera rides it: the controller, the service, the orders table it writes, HTTP into billing (Python), Kafka into shipping → "Three services. One tab." → back to the controller, which is the first frame, and the tag.
- The joke: the string-and-pins conspiracy board every developer has drawn in their head, and the punchline that it *is* all connected; the editor draws it for you.
- Why it was picked: the joke turns into the product picture (the board becomes the canvas), and the pain (the first week, the Ctrl+Click rabbit hole) is universal.

**B. Ask Dave**

- Hook: "How does checkout work?" "Ask Dave." "Dave left in March."
- Beats: Dave's farewell card (drawn) → the only documentation Dave left is a sticky note: "it's complicated" → a search for "invoice" returns everything → the narrator opens the endpoint: the flow is drawn from the code as it is today → "Dave's in a tab now." The pet wears a tiny "Dave" name badge.
- The joke: the bus-factor senior, and the canvas as the colleague who never leaves.
- Risk: the joke leans on a person; it must stay warm (Dave is not the villain).

**C. 2 a.m.**

- Hook: "2:07 a.m. Orders go through. Nobody gets an invoice."
- Beats: a phone buzzing on the nightstand (drawn) → a sleepy grep for "invoice", results scrolling past → the narrator opens POST /orders: the order calls billing over HTTP, a different service in a different language → "Now you know which service to look at, and who to wake up." → back to bed, the pet asleep on the keyboard.
- The joke: the on-call panic, and the pet asleep at the end.
- Risk: it must not claim the canvas *finds* the bug; it shows where the request goes, which is where to look.

## Episode 05: Performance review (2026-10-23)

The first voiced episode that is a **format** instead of a "developer has a problem" story: a deadpan HR performance review of the AI intern, narrated by a tired manager ([episodes/05-agent-review.json](../shorts/episodes/05-agent-review.json), 46 s). The feature is **Show Git Changes in Flow** ("Review what an agent changed, on the flow" in the README): one canvas holds the whole change set, cut down to the changed methods, added lines green, removed lines red.

- **Beats.** The real editor with the agent's real commit in the terminal (`14 files changed, 112 insertions(+), 16 deletions(-)`, the film's staged commit) is frame 0 and the loop frame. A drawn HR form fills in over it; the manager scrolls a drawn printout of the 14 real file names while the scrollbar shrinks to a pixel and the clock chip runs from Tuesday to Thursday; the cat (HR) asks "Meets expectations?", the manager stamps UNCLEAR. Then the real captures: `C3-changes` (14 changed files, Affects 10 endpoints), and `C4-place` where `OrderService.place` shows one red line out and two green lines in (`+2 -1`) and `applyDiscount` is new (`+11 -0`). The manager's stamp is STILL YOUR CALL: the canvas shows what changed, it does not judge it. The closing joke is the agent's own self-assessment card ("EXCEEDS EXPECTATIONS", signed by the agent) and HR's "Obviously."
- **Honesty.** Every number on the canvas pictures is from the capture. The form, the printout, the sticky note, the stamps and the card are drawn and look drawn; none imitates Insilode's UI. The commit is staged for the demo. The episode never says the change is right, approved or bug-free.
- **Voice.** A second voice for the series: the manager is the film audition's deep male reference (Bloxam, `male.wav`, exaggeration 0.3), HR is the model's built-in voice, so the captions label her `HR:`. Chatterbox says "Insilode" best from the respelling `Insylode` with seed 11 (the final mix's ASR hears "InSiload"); `Third quarter` replaces "Q3" in the spoken line because the model reads "Q three" as "two three".
- **Scenes.** `story-review` (the form, the printout, the cat; its first frame is the loop frame), `story-changes` (the two captures with green and red rings, change chips, the stamp, the self-assessment card; the detail capture comes up through the picture's bottom edge and leaves the same way), and `story-end` (unchanged, the loop frame under the tag). A composition can be used once per episode (the host id is its name), so the overview-to-detail swap lives inside `story-changes`.
- **Row 5.** The table's "Agent Court" is held back until its dock capture exists; this episode took the number 05 and does not replace it.
