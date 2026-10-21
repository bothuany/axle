# Generates every voiceover line of vo/script.json with Chatterbox on the GPU, one WAV per line.
#   python -I vo.py <film dir> <out dir> [id ...]
# The product's spoken name comes from brand.json, so a rename only re-runs the lines that say it.
# Run it with the Chatterbox venv (outside the repo); the WAVs stay outside the repo too.
import json
import sys
from pathlib import Path

import soundfile
import torch
from chatterbox.tts import ChatterboxTTS

film, out = Path(sys.argv[1]), Path(sys.argv[2])
only = set(sys.argv[3:])
brand = json.loads((film / "brand.json").read_text(encoding="utf-8"))
script = json.loads((film / "vo" / "script.json").read_text(encoding="utf-8"))
out.mkdir(parents=True, exist_ok=True)

model = ChatterboxTTS.from_pretrained(device="cuda")
for line in script["lines"]:
    if only and line["id"] not in only:
        continue
    text = line["text"].replace("{spokenName}", brand["spokenName"])
    # The same seed per line keeps a re-run of one line identical to the first take.
    torch.manual_seed(7)
    wav = model.generate(text, exaggeration=0.4, cfg_weight=0.5)
    path = out / f"{line['id']}.wav"
    soundfile.write(path, wav.squeeze(0).cpu().numpy(), model.sr)
    print(line["id"], round(wav.shape[-1] / model.sr, 2), "s", text)
