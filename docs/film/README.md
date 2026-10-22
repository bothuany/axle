# Launch film

The launch film (v3, 62 s), its 1:1 and 9:16 cuts and the silent 15 s loop, made with
[HyperFrames](https://hyperframes.heygen.com) from the app's own rendering. The plan is [STORYBOARD.md](STORYBOARD.md);
the brief is [BRIEF.md](BRIEF.md). The delivered files are in [docs/media/film](../media/film).

v3 opens on the whole editor window and says what Insilode is ("a code editor, built on VS Code") before what it adds;
every feature is shown inside that window. Nothing in the window is drawn for the film: every frame is a headless
capture of the workbench in web mode (Insilode Dark) on Harbor Goods, the playground's demo project, with a real
14-file change committed for the film ([demo/](demo)), and the dock page's own live take laid over the dock. The film
adds the site's dark stage, camera moves, two rings, one label, captions, the headline and the end card. The voice is
generated on this machine by an open model (Chatterbox, MIT) cloned from a public-domain LibriVox reading; the music
is composed and synthesized in code.

Stills, captures, voice takes and renders are working material and stay out of the repo (a "shots" folder outside
it, e.g. `%LOCALAPPDATA%\Temp\insilode-film-v3\shots`). Only the delivered files go in `docs/media/film`.

## The name and the copy

The product name, the slogan (headline and end card), the download line, the URLs and the licence line live in [brand.json](brand.json).
`spokenName` is the spelling the voice model says closest to IN-sih-lohd ("Insihlode"); the captions show
`productName`. Copy follows `docs/design/messaging.md`. The end line ("It's free, and it's open source.") has an
alternative take in `vo/script.json` (`09alt`, "It's free, and the source is open.") for a licence change.

## Rebuild

Everything runs headless; nothing opens a window.

1. **Captures.** [capture/workbench/README.md](capture/workbench/README.md) for the editor stills (into `<shots>/wb` as
   JPEG); the dock take is `capture/agents-live.mjs` (into `<shots>/capture/dock-live.mp4`).
2. **Voice.** `python -I tools/vo.py . <reference.wav> <shots>/vo` with the Chatterbox venv makes one raw take per
   line of [vo/script.json](vo/script.json) (seed, exaggeration and cfg per line; the reference is named there), then
   `node tools/vo-finish.mjs <shots>` trims each, opens its pauses, stretches it to a calm pace (2.3-3.0 words/s,
   rubberband, pitch kept), normalizes it and transcribes it for its word times (`<id>.words.json`).
3. **Music.** `python -I tools/score.py <shots>/music/score.wav` composes and synthesizes the bed in code (NumPy, no model).
4. **Mix.** `node tools/mix.mjs <shots> <shots>/music/score.wav`: the voice at its times, the bed ducked under it,
   effects synthesized with ffmpeg (`<shots>/audio/sfx`), loudness about -14 LUFS.
5. **Projects.** `node tools/build.mjs <shots>` writes one HyperFrames project per variant (`film`, `square`,
   `vertical`, `loop`) under `<shots>/build/`; check one with `npx hyperframes snapshot --at <seconds>`.
6. **Deliver.** `node tools/deliver.mjs <shots> docs/media/film` renders each variant and writes the small files and
   the per-feature clips (`editor`, `endpoint`, `change-set`, `agents`, `harness`, `loop-15s`).

Timings shared by picture and sound are in [tools/timing.mjs](tools/timing.mjs).
