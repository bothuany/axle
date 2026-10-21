# Launch film

The launch film, its 1:1 and 9:16 cuts and the silent 15 s loop, made with [HyperFrames](https://hyperframes.heygen.com)
from the app's own rendering. The plan is [STORYBOARD.md](STORYBOARD.md); the brief is [BRIEF.md](BRIEF.md). The
delivered files are in [docs/media/film](../media/film).

Nothing in the picture is drawn for the film: every product frame is a capture of the app (the canvas, its tour, the
Agents dock and status island pages, the workbench in web mode) on Harbor Goods, the playground's demo project, with a
real 14-file change made for the film ([demo/](demo)). The film adds framing, camera moves, rings, type and captions.
The voice and the music are generated on this machine by open models.

Stills, captures, voice takes and renders are working material and stay out of the repo (`%LOCALAPPDATA%\Temp\axle-film-shots`
below, the "shots" folder). Only the delivered files go in `docs/media/film`.

## The name

The product name may change. It lives in [brand.json](brand.json) only: the titles, the loop's last word, the lockup and
the CTA read it, and the one voice line that says it is generated from `spokenName`. To rename: edit `brand.json`, run
step 2 for line `10` only, then steps 4 to 6.

## Rebuild

Everything runs headless; nothing opens a window.

1. **Captures.** Build the playground data with the film's change and serve the built playground, then run
   [capture/film.mjs](capture/film.mjs); start `npm run web -- <demo repo>` and drive it with
   [capture/workbench-driver.mjs](capture/workbench-driver.mjs) for the boards and Home. See [capture/README.md](capture/README.md).
2. **Voice.** `HYPERFRAMES_PYTHON=<kokoro venv python> node tools/vo-kokoro.mjs <shots> [line ids]` generates each line
   with Kokoro-82M (Apache-2.0), voice `bm_george`, and transcribes it for its word times (`<id>.words.json`).
   Lines: [vo/script.json](vo/script.json). `tools/vo.py` makes Chatterbox takes of the same lines instead.
3. **Music.** `python tools/music.py <ACE-Step-1.5 dir> <shots>/music [seeds]` in an ACE-Step 1.5 checkout (code and
   weights MIT; the model card allows commercial use of the output).
4. **Mix.** `node tools/mix.mjs <shots> <music.wav>`: voice at its times, the bed silent under the hook and ducked
   under the voice, effects synthesized with ffmpeg (`<shots>/audio/sfx`), loudness about -14 LUFS.
5. **Projects.** `node tools/build.mjs <shots>` writes one HyperFrames project per variant (`film`, `square`, `vertical`,
   `loop`) under `<shots>/build/`; check one with `npx hyperframes snapshot --at <seconds>`.
6. **Deliver.** `node tools/deliver.mjs <shots> docs/media/film` renders each variant and writes the small files and
   the per-feature clips.

Timings shared by picture and sound are in [tools/timing.mjs](tools/timing.mjs).
