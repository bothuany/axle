# Generates the raw voice takes of one voiced episode with Chatterbox (ResembleAI/chatterbox, MIT) on the GPU, locally.
#   <chatterbox venv python> -I vo.py <takes.json> <out dir>
# takes.json (written by tools/vo.mjs): {"takes": [{"id", "text", "ref" (wav or null), "exaggeration", "cfg", "seed",
# "temperature"}]}. A take with a reference is conditioned on that voice (the film's public-domain LibriVox reading);
# one without uses the model's built-in voice. Each take has its own seed, so a re-run makes the same take.
# Nothing is downloaded here but the TTS model's own weights on first use; no language model is involved.
import json
import sys
from pathlib import Path

import soundfile
import torch
from chatterbox.tts import ChatterboxTTS

spec = json.loads(Path(sys.argv[1]).read_text(encoding="utf-8"))
out = Path(sys.argv[2])
out.mkdir(parents=True, exist_ok=True)
model = ChatterboxTTS.from_pretrained(device="cuda")
# A reference replaces the model's conditionals for every later call, so the built-in voice is kept aside and put back
# before a take without one.
builtin = model.conds
for take in spec["takes"]:
    torch.manual_seed(int(take["seed"]))
    kw = {"exaggeration": take["exaggeration"], "cfg_weight": take["cfg"], "temperature": take.get("temperature", 0.8)}
    if take.get("ref"):
        kw["audio_prompt_path"] = take["ref"]
    else:
        model.conds = builtin
    wav = model.generate(take["text"], **kw)
    soundfile.write(out / f"{take['id']}.wav", wav.squeeze(0).cpu().numpy(), model.sr)
    print(take["id"], round(wav.shape[-1] / model.sr, 2), "s", take["text"], flush=True)
