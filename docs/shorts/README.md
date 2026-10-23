# Shorts ("Dry Run")

The HyperFrames project behind the vertical shorts. The design is in [docs/design/shorts-system.md](../design/shorts-system.md); read that first.

```bash
node tools/setup.mjs                                        # once: captures, pets, icon (ffmpeg)
node tools/episode.mjs episodes/01-allow-or-deny.json       # builds build/01-allow-or-deny (a project of its own)
node tools/episode.mjs episodes/01-allow-or-deny.json --here  # writes index.html here (the committed example)
cd build/01-allow-or-deny && npx hyperframes check
npx hyperframes snapshot --at 0.2,3.8,14.6,17.9
npx hyperframes render --output renders/01-allow-or-deny.mp4 --fps 30
```

A voiced story (an episode with `vo` and `scenes`, e.g. `episodes/02-flow-conspiracy-board.json`) is voiced first, then built:

```bash
node tools/vo.mjs episodes/02-flow-conspiracy-board.json      # Chatterbox takes -> work/<id>/voice.wav + vo.json (word times)
node tools/episode.mjs episodes/02-flow-conspiracy-board.json # captions from the words, the bed ducked under the voice
cd build/02-flow-conspiracy-board && npx hyperframes check && npx hyperframes render --output renders/02-flow-conspiracy-board.mp4 --fps 30
node tools/deliver.mjs build/02-flow-conspiracy-board/renders/02-flow-conspiracy-board.mp4 <out dir> 02-flow-conspiracy-board
```

`vo.mjs` needs the Chatterbox venv (`INSILODE_TTS_PYTHON`, default `~/insilode-tts/chatterbox-venv`) and the film's reference reading (see the episode's `vo.voices`). `deliver.mjs` writes the phone copy at -15 LUFS and a contact sheet.

`check` passes after `setup.mjs` (the captures are not in git). Python with NumPy is needed for the music and the effects (`tools/score.py`).
