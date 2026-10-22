# Insilode launch video and website: research for a from-scratch redo

Researched 2026-10-21 with the obscura browser. "Verified" means I read it on the linked page this session. "[unverified]" marks claims from memory or from sources I could not check. Star counts and versions are as shown on the pages that day.

---

## 1. Video with Claude: current practice (2025-2026)

### 1.1 The frameworks

| Tool | What you write | Agent fit | License | Notes for Insilode |
|---|---|---|---|---|
| **HyperFrames** (HeyGen) [repo](https://github.com/heygen-com/hyperframes), [docs](https://hyperframes.heygen.com/introduction) | Plain HTML/CSS plus a **paused GSAP timeline** registered on `window.__timelines`. Clips are DOM elements with `data-start`, `data-duration` and `data-track-index` | Built for agents. It ships a Claude Code plugin (`claude plugin install hyperframes@hyperframes`) and skills (`/hyperframes`, `-cli`, `-registry`, `/media-use`) that cover plan, storyboard, lint, check, snapshot and render. A registry of about 450 blocks (transitions, kinetic type, captions, code and terminal windows) | Apache-2.0 | Repo shows about 69k stars. Needs Node 22+ and FFmpeg. Renders locally on Windows: the troubleshooting page has a Windows FFmpeg path and says to render from PowerShell so Chrome uses the GPU through Direct3D ([troubleshooting](https://hyperframes.heygen.com/guides/troubleshooting)). Already installed in this environment as skills. |
| **Remotion** [agents](https://www.remotion.dev/docs/ai/coding-agents), [skills](https://www.remotion.dev/docs/ai/skills) | React components that are a function of `useCurrentFrame()` | Good. Official `npx skills add remotion-dev/skills`, and `npx create-video --yes --blank` | Own license: **free for individuals and companies of up to 3 people**, paid above that ([pricing](https://www.remotion.dev/docs/license/pricing)) | The one real pull is that Insilode's `ui/` is React, so Remotion could import the canvas components directly. Check the license if the owning organization has 4 or more people. |
| **Revideo** [repo](https://github.com/midrender/revideo) (moved from redotvideo to midrender) | TypeScript scene graph (a Motion Canvas fork) with a headless render API | Fine, but smaller ecosystem | MIT | About 4.1k stars. No agent skills that I found. |
| **Motion Canvas** [repo](https://github.com/motion-canvas/motion-canvas) | TypeScript generators on a canvas, with an editor UI | Weak for headless agents: rendering is editor-driven [unverified that a headless CLI exists today] | MIT | Good for explainer diagrams, but a poor fit for "no window". |
| **Manim** (Python) | Math-style scene code | Good for diagram animation, not product UI | MIT | Only useful for a "diagrams from code" B-roll beat. Overkill. |

HyperFrames' own comparison ([hyperframes-vs-remotion](https://hyperframes.heygen.com/guides/hyperframes-vs-remotion)) gives a fair read:
- **Remotion** is more mature, and it is the better pick when you already have React components.
- **HyperFrames** is better when web material (HTML, GSAP, Lottie) should drop in close to as-is.
- **The HyperFrames contract.** Its determinism rules are strict: no `Date.now()`, no `requestAnimationFrame`, no unseeded randomness, no fetching mid-render ([determinism](https://hyperframes.heygen.com/concepts/determinism)).
- **What this means for embedding the real canvas.** A live React Flow and Monaco app cannot just run inside a composition. It must be driven into fixed states, or brought in as captured footage or stills (see section 4).

**AI tools that pair with Claude:**
- **Voiceover:** ElevenLabs or another TTS provider, or the local and HeyGen options in HyperFrames `/media-use`, which per the README covers music, SFX, voiceover, transcripts and captions with "HeyGen or free local tools".
- **Music:** licensed beds or a generated bed.
- **Specialist skill packs:** baz ([guide](https://baz.studio/how-to/make-a-product-launch-video)) sells "launch video skills" that run inside Claude Code. Generative video models (Runway, Veo and similar) are not useful for UI footage and are the fastest way to look generic. [general observation]

### 1.2 Workflow that works

This combines HyperFrames' product-video guide, the baz guide and the ShipScenes teardown:
1. **One problem sentence.** Name the single pain the product removes. If you cannot say it in one sentence, the film will not hold 60 seconds ([baz](https://baz.studio/how-to/make-a-product-launch-video)).
2. **Gather evidence before you script.** Collect real screens, real labels, brand tokens, the tagline, the exact CTA URL and one defensible metric.
3. **Script from your own copy.** Use the README and site language, and cut adjectives ("seamless", "powerful").
4. **Storyboard and approve it before animating.** HyperFrames explicitly supports "ask for a storyboard first" ([product-launch guide](https://hyperframes.heygen.com/guides/product-launch-video)).
5. **Beats on a music grid.** Pick the bed first, then snap cuts to bars. HyperFrames has a `beats` CLI command.
6. **Capture or rebuild the UI.** HyperFrames' stance: "animate captured product material or rebuild only the part that needs to move. A raw screen recording is not the default."
7. **Camera, then sound.** Push into the moment that matters, add SFX tied to on-screen changes, then a VO or captions pass.
8. **Review loop.** Lint and check, take frame snapshots, watch the whole film once at full speed, then fix only what bothers you.

### 1.3 Shape and pacing

- **Two independent sources agree on structure.** baz gives a beat table and ShipScenes analyzed "720+" launch films ([dev.to](https://dev.to/shipscenes/we-analyzed-720-ai-startup-launch-videos-openai-linear-cursor-raycast-here-is-the-4-beat-43c)). Both land on 45-60 s in roughly four beats:
  - Hook or problem: 0-5 s. No logo first.
  - Turn: about 5-12 s, where the first real UI appears.
  - Proof: 2-4 capabilities, each shown working, about 12-38 s.
  - Credibility: about 38-50 s.
  - Lockup and one CTA: last 10 s.
- **ShipScenes' precise numbers are self-reported marketing and [unverified]:** "-13.8 to -11.9 LUFS", "122-128 BPM", "84% follow 4 beats" and spring constants. Treat them as a sanity range, not a spec.
- **Length.** 45-60 s for the launch cut. Make a separate 15-20 s loop for the README and hero, plus optional 20-30 s per-feature clips.

### 1.4 What separates good from AI-generic

- **Real product, legible.** Generic AI videos use invented dashboards. Good ones show the actual UI with real labels and real code, sharp enough to read, and push the camera in on one control. Rebuilding or seeking the real UI beats a soft screen recording (baz: recordings "lock you to one resolution and one account state").
- **One idea per shot.** Two to four features, not seven. Insilode has seven, so pick three for the launch cut: call-flow canvas, the ghost-cursor tour, and the agent dock. Use the rest as a quick montage or separate clips.
- **Typography as a character.** One deliberate typeface with strong scale contrast, kinetic type only on the hook and the lockup, and never captions-as-decoration on every shot.
- **Sound sold to picture.** Key clicks, UI ticks and whooshes tied to real state changes, with the bed ducked under VO. baz: sound is "the difference between 'made with AI' and 'made by a studio'".
- **VO or captions.** Most viewers start muted, so burned-in captions or on-screen text must carry the story alone. VO is optional. A human VO beats stock TTS. Mediocre TTS is a strong "AI" tell [general observation].
- **Tells to avoid:**
  - gradient-blob backgrounds;
  - stock ukulele music;
  - a logo opening;
  - every element fading and sliding in;
  - generic 3D device mockups;
  - feature bullet lists on screen.

### 1.5 Standout dev-tool launch videos

These are from memory and were not re-watched this session [unverified]:
- **Linear:** dark, slow and confident. Precise real UI on near-black, restrained type, and one camera move per shot.
- **Raycast:** tactile and keyboard-first, with keystroke SFX. Their site even renders a keyboard (verified on [raycast.com](https://www.raycast.com)).
- **Arc** (The Browser Company): personality-led, with founders on camera and handmade warmth. The opposite of slick.
- **Zed:** speed demos with real typing at real framerate, plus engineering-story films.
- **Warp:** terminal-native aesthetics.
- **Cursor:** product-in-use clips over a painterly brand background (verified on [cursor.com](https://cursor.com): "an interactive demo ... displayed over a subtle, solid brand background").
- **Vercel:** typographic, high-contrast keynote films.

Common thread: each has one visual idea that belongs only to that product.

**Where to watch them.** These are official channels. I found them by search but did not watch them, so pick the specific films there:
- Zed: [youtube.com/@zeddotdev/videos](https://www.youtube.com/@zeddotdev/videos)
- Raycast: [YouTube channel](https://www.youtube.com/channel/UCPvOHaaP9E6FqSqG1NMV_Hw) and [x.com/raycast](https://x.com/raycast)
- Linear: [linear.app/now](https://linear.app/now) [unverified that each post embeds its launch film]
- A curated gallery of about 720 launch films with beat teardowns: [shipscenes.com/leaderboard](https://shipscenes.com/leaderboard) [not opened]

---

## 2. Websites with Claude

### 2.1 Anthropic's guidance (verified)

- **The cause.** The [frontend-design article](https://claude.com/resources/articles/improving-frontend-design-through-skills) (Nov 2025) names the cause "distributional convergence": without direction, Claude samples Inter, purple-on-white gradients and minimal animation. It is "highly steerable": naming defaults to avoid and alternatives to prefer, along typography, color/theme, motion and backgrounds, improves output immediately. Prompt "at the right altitude", meaning neither hex codes nor vague vibes.
- **The current [frontend-design SKILL.md](https://raw.githubusercontent.com/anthropics/skills/main/skills/frontend-design/SKILL.md)** (installed here as `frontend-design`) adds concrete rules:
  - **Ground the design in the subject's vernacular.** For Insilode that is call graphs, cursors, terminals, harness wiring.
  - **Hero:** open with "the most characteristic thing in the subject's world", for example a live demo. The big-number-plus-gradient hero is the default to avoid.
  - **Type:** one or two deliberate families on a real type scale. Avoid single-word accent colors or italics in headlines, all-caps labels, and decorative eyebrows.
  - **Structure is information.** Use 01/02/03 markers only for real sequences.
  - **Motion:** one orchestrated moment beats scattered fade-and-slide-ups.
  - **Known AI clusters to avoid unless chosen:**
    - cream plus serif plus terracotta (#D97757);
    - near-black plus a single acid-green accent;
    - broadsheet hairlines;
    - the SaaS-card kit with identical radius and shadow;
    - template chrome: ALL-CAPS eyebrows, "A · B · C" meta strings, a monospace face for small labels, "→" on every link.
  - **Process:** write a token plan first (4-6 named hex colors, type roles, ASCII wireframes for layout, principles). Review it against "would I produce this for any similar brief?" and revise. Then build, then critique.
- **Caution for Insilode.** As a dev tool, Insilode will be pulled toward cluster 2 (near-black plus a neon accent) and toward "mono labels everywhere". Choose deliberately, or derive the look from Insilode's own canvas UI.

### 2.2 Prompting patterns that produce non-templated pages

1. **Brief, not prompt.** Give subject, audience, primary job, the one thing the visitor should do, and real copy. Copy from README and docs prevents template copy.
2. **Design plan as a separate, reviewed artifact.** Use the skill's two-pass process. Ask for three distinct directions as ASCII wireframes plus tokens, pick one, then build.
3. **Reference by property, not by brand.** "Hero is the product itself, like Zed and Linear render live HTML of their app" works better than "make it look like Linear", which copies the surface.
4. **Real product visuals only.** Embed the actual canvas, use real screenshots from `npm run web`, and use real repo content.
5. **Critique loop with screenshots.** Render headless at 375 and 1440 widths, have Claude list generic tells against the skill's cluster list, then fix. Our probe and browser-pane setup already does this without focus stealing.

### 2.3 Standout dev-tool landing pages

Verified this session unless marked otherwise:
- **Zed** ([zed.dev](https://zed.dev)): the hero is a **live HTML rendition of the product** with real-looking content (the real `sum_tree` crate, real teammates' avatars, an agent thread editing real files, a review comment). Two products side by side ("Est 2021", "Est 2026"), one line each: "The world's fastest IDE. Open source. AI optional."
- **Linear** ([linear.app](https://linear.app)): also an HTML-rendered app UI in the hero, with a plausible issue ("Faster app launch"), agent activity, and real team avatars. The headline is short and the UI does the selling.
- **Cursor** ([cursor.com](https://cursor.com)): an interactive multi-surface demo (Desktop and CLI) over an artful brand backdrop, and OS-aware "Download for macOS" as the primary CTA.
- **Raycast** ([raycast.com](https://www.raycast.com)): OS-detected "Download for Windows" with "Install via WinGet". The section design is an actual keyboard rendered in HTML. Claims are concrete ("99.8% crash-free rate").
- **Warp** ([warp.dev](https://www.warp.dev)): the whole site speaks terminal (lowercase, "warp · home · 2026" path-like chrome), with "Star Warp" in the nav.
- **Ghostty** ([ghostty.org](https://ghostty.org)): a giant animated ASCII-art ghost drawn in terminal glyphs, one sentence, and two buttons (Download, Documentation). Pure subject-matter identity.
- **Bun** ([bun.com](https://bun.com)):
  - The hero is the install command, with macOS/Linux and Windows tabs.
  - Animated benchmark bars ("replay in real time"), each with methodology and a **"reproduce" link** to the bench source.
  - Credibility through verifiable numbers.
- **tldraw** ([tldraw.dev](https://tldraw.dev)): the GitHub star count (51K) in the nav, `npm create tldraw` plus a code sample in the hero, and a customer logo wall. [unverified: whether the hero canvas is live; tldraw.com itself is the live app.]
- **Excalidraw** [unverified this session]: the landing page *is* the working canvas. That is the ultimate "live demo", and it is directly relevant to Insilode's canvas.
- **Astro** ([astro.build](https://astro.build)): Playground and Themes in the nav, and community links (Discord, GitHub) everywhere.
- **Vercel v0** [unverified]: a prompt box as the hero, so the visitor starts using it in one keystroke.

---

## 3. Patterns that convert for open-source dev tools

Main source: Evil Martians, [100 dev tool landing pages](https://evilmartians.com/chronicles/we-studied-100-devtool-landing-pages-here-is-what-actually-works-in-2025) (Jul 2025), plus the pages above.
- **General:** "No salesy BS" and "clever and simple wins". Most pages use a centered, max-width layout. Full-bleed reads premium but is harder to execute.
- **Hero:**
  - A centered headline over a product visual. In order of power: live embed, animated UI, switchable UIs, static UI.
  - A live embed is "a power move if you can pull it off". For Insilode it is realistic, because the canvas already runs in web mode.
  - Use an eyebrow for the latest release only if it is real news.
- **CTAs:**
  - Two, visually distinct. The primary is specific ("Download for Windows", not "Get started").
  - The secondary is GitHub or Docs.
  - Detect the OS like Cursor and Raycast do, and show `winget` or `brew` alternatives the way Bun shows its install command.
- **Trust for individual-oriented tools:**
  - Use numbers (GitHub stars, downloads) rather than logos.
  - Put a live star count in the nav (tldraw, Warp).
  - Do not fake logos. Early on, use a quote from a real user or a "built with Insilode" proof, such as the repo dogfooding itself.
- **Features:**
  - Problem-oriented stories convert better than function lists.
  - One section per real pain, each with a real UI loop: "you ask an agent to change X, you can't see what it touched" leads to the call-flow canvas plus impact.
- **Proof:** concrete, reproducible claims (Bun's reproduce links). For Insilode, link each claim to the doc or test that proves it.
- **Final CTA:** repeat the install, plus a GitHub star button and the changelog. OSS visitors also look for the license, contributing guide and roadmap.
- **Playground:** keep it separate from the hero, as a product tour with live tiles (matches the user's stated preference, memory note "Playground presentation"). Do not clone the IDE.

---

## 4. Tooling recommendations for Insilode

### 4.1 Video: HyperFrames, rendered headless on Windows, with the real canvas as the footage source

- **Why HyperFrames over Remotion:**
  - It is Apache-2.0, so there is no headcount license question.
  - It is already installed here as skills, with a storyboard, beats and check loop built for agents.
  - Renders run headless Chrome and FFmpeg from PowerShell on Windows, with no visible window.
- **Which CLI commands are safe.** Verified in the installed `hyperframes-cli` skill (`references/preview-render.md`, `beats.md`, `upgrade-info-misc.md`):
  - **Safe, headless:** `render` (headless Chrome or chrome-headless-shell, BeginFrame capture, then FFmpeg), `snapshot`, `beats`, `lint` and `docs`.
  - **Opens a window:** `preview`, which "opens Studio in the browser automatically". The skill's default loop ends with `preview --background` for user review, so override that in the agent's instructions.
  - **The safe alternative to preview:** start the server, then open `http://localhost:<port>/#project/<name>` in the built-in browser pane. [unverified whether `--background` suppresses the auto-open]
  - **`present`:** has `--no-open`.
  - **`play`:** treat it like `preview`.
  - **`check`:** "reruns lint before opening the browser". I believe this is the headless validator, but run it once and watch to confirm. [unverified]
  - **Auth:** `auth login` opens the browser, so only do it if HeyGen cloud is wanted.
- **Pick Remotion only if** you decide to compose the actual React canvas components inside the video, and only after checking the license.
- **Getting real UI in, without mock UI and without screen takeover:**
  1. **Headless capture from web mode.**
     - Run `npm run web` on a curated demo project, then drive it with headless Playwright or Puppeteer.
     - Use `page.screenshot` at 2x DPR for crisp stills, and `recordVideo` or a CDP screencast for motion. All of this is off-screen.
     - Script each beat: open flow, start tour, ghost cursor moves, board renders, dock streams a reply.
  2. **Compose in HyperFrames.**
     - Place stills and clips as layers. Do camera push-ins and highlight rings with GSAP keyframes.
     - Use registry blocks for code windows, captions and transitions.
     - Re-type key text, such as the tour caption, in HTML so it stays razor-sharp.
  3. **Optional deterministic embed.** For shots that need perfect sharpness at any zoom, add a "film mode" to the canvas bundle: state set by a frame or time query param, with rAF and animations disabled. HyperFrames can then seek it frame by frame. This respects the determinism rules [design proposal, untested].
  4. **The desktop-only feature (status island)** cannot be captured headlessly on the dev machine. Capture it inside Windows Sandbox or desktop-e2e CI (per CLAUDE.md), or rebuild just that small element in HTML from its real styles.
- **Deliverables:**
  - 50-60 s launch cut, 16:9, captions burned in, optional VO.
  - 15 s silent README and hero loop: MP4 plus a WebM or AVIF fallback, under about 5 MB.
  - 1:1 or 9:16 social cuts from the same project.
- **Story:**
  - Hook: "Your agent changed 14 files. Where?"
  - Turn: Insilode opens the call-flow canvas.
  - Proof: (1) the ghost-cursor tour walks the flow, (2) skeleton-first and diagrams from code, (3) the agent dock running Claude Code and Codex side by side.
  - Credibility: open source, a VS Code fork, the extensions you already use.
  - Lockup: a download or winget line plus the GitHub URL.

### 4.2 Site: Vite on GitHub Pages, with the real canvas as the hero

- **Hero:**
  - Embed the built `ui/` canvas bundle with a recorded fixture: a real `flow_text` and board JSON from a demo repo, served statically.
  - Visitors pan and zoom the real call-flow, and one button starts a ghost-cursor tour on the page.
  - This gives Insilode the Zed/Linear/Excalidraw "product is the hero" move with real data.
- **Load strategy:** keep a static poster frame plus the 15 s loop as an instant first paint, and lazy-load Monaco.
- **Process:**
  1. Write a brief from README facts.
  2. Run the `frontend-design` skill's two passes: three directions as ASCII and tokens, a "generic?" review, then build.
  3. Derive tokens from Insilode's own canvas theme so site and product match.
  4. Build in Vite.
  5. Run headless screenshot critique at 375 and 1440 widths against the skill's cluster list.
  6. Verify Lighthouse and CSP.
- **Sections:**
  1. Hero with the live canvas and OS-aware download (winget or zip) plus a GitHub button with a live star count.
  2. One problem-led section per pillar, each with a real looping clip from the video project, so the assets are shared.
  3. A "how it works with your agent" strip covering Claude Code, Codex and MCP tools.
  4. Proof: open-source license, a changelog showing in-app updates, and links to tests and docs.
  5. A final install CTA.
- **Avoid:** card grids of seven features, gradient blobs, ALL-CAPS eyebrows, mono micro-labels everywhere, fade-up on every section, and the near-black-plus-neon default unless it is chosen on purpose.
