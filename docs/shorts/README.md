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

`check` passes after `setup.mjs` (the captures are not in git). Python with NumPy is needed for the music and the effects (`tools/score.py`).
