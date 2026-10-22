# Generates every voiceover line of vo/script.json with Chatterbox on the GPU, one raw take per line, cloned from the
# reference voice (script.json "voice.reference", cut to 12 s; public domain).
#   python -I vo.py <film dir> <reference.wav> <out dir> [id ...]
# Each line has its own seed, exaggeration and cfg, so a re-run makes the same take. The product's spoken name comes
# from brand.json, so a rename only re-runs the lines that say it. Run it with the Chatterbox venv (outside the repo);
# the WAVs stay outside the repo too. tools/vo-finish.mjs turns the raw takes into the film's lines.
import json
import sys
from pathlib import Path

import soundfile
import torch
from chatterbox.tts import ChatterboxTTS

film, ref, out = Path(sys.argv[1]), sys.argv[2], Path(sys.argv[3])
only = set(sys.argv[4:])
brand = json.loads((film / "brand.json").read_text(encoding="utf-8"))
script = json.loads((film / "vo" / "script.json").read_text(encoding="utf-8"))
(out / "raw").mkdir(parents=True, exist_ok=True)

model = ChatterboxTTS.from_pretrained(device="cuda")
for line in script["lines"]:
    if only and line["id"] not in only:
        continue
    text = line.get("say", line["text"]).replace("{spokenName}", brand["spokenName"]).replace("{productName}", brand["productName"])
    torch.manual_seed(line["seed"])
    wav = model.generate(text, audio_prompt_path=ref, exaggeration=line["exaggeration"], cfg_weight=line["cfg"], temperature=script["voice"]["temperature"])
    soundfile.write(out / "raw" / f"{line['id']}.wav", wav.squeeze(0).cpu().numpy(), model.sr)
    print(line["id"], round(wav.shape[-1] / model.sr, 2), "s", text)
