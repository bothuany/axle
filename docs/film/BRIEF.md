---
workflow: general-video
flow: automation
storyboard: yes
message: "Your agent changed the code. Axle shows you where, on how it runs."
destination: README, website hero, YouTube, X / LinkedIn / Shorts
aspect: 16:9 (launch film); 1:1 and 9:16 social cuts; 16:9 silent loop
language: en
audience: developers who run Claude Code or Codex on real codebases
length: 60-90 s launch film, 15 s silent loop
voiceover: yes, English, generated locally (no cloud TTS)
captions: burned in
---

# Axle launch film, from scratch

## Intent

A new launch film for Axle, the harness-first code editor (a VS Code fork). It opens on the
problem, not the logo: "Your agent changed 14 files. Where?" Then the call-flow canvas answers
it, then three features, then one call to action (download, plus the GitHub link).

Made fresh: the earlier video, poster and brag outputs are not reference material.

## Customizations

- Real product UI only, captured headless from Axle's web mode (`npm run web`) with Playwright
  at 2x. No mock UI. What the capture cannot move is rebuilt from Axle's own pages, never drawn
  from memory.
- The status island cannot be shown on a desktop here; use the island page Axle itself ships
  (cut from `editor/patches/flow-desktop.patch` by `scripts/playground-data.mjs`), captured headless.
- Voiceover from a local open model on this machine (RTX 5080), licence allowing commercial use.
- Deliverables: the 60-90 s film; a silent 15 s loop for the README and the site hero; 1:1 and
  9:16 cuts from the same project; a poster frame; per-feature clips in `docs/media/film/clips/`
  with stable names for the website.
- Everything renders headless. `hyperframes preview`, `play` and any window are off limits.

## Assets

- Logo: `editor/branding/icon.png` (used in the build, never committed again).
- Palette: Axle's canvas theme (`ui/src/styles.css`).
- Demo project: Harbor Goods (`playground/demo/base`), with a real change authored for the film.
