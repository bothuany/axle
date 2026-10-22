# Generates the film's music bed locally with ACE-Step 1.5's music model alone (no language model: the tempo, key,
# length and description are set here, so its optional 5Hz LM planner is neither downloaded nor run) (code MIT, weights MIT; generated music may be used
# commercially per the model card). Run from an ACE-Step-1.5 checkout's venv, outside the repo:
#   python music.py <ACE-Step-1.5 dir> <out dir> [seed ...]
# Each seed gives one take; the film uses the take picked by ear and by its beat grid (hyperframes beats).
import os
import sys

root, out = sys.argv[1], sys.argv[2]
seeds = [int(s) for s in sys.argv[3:]] or [11, 23, 37]
sys.path.insert(0, root)

from acestep.handler import AceStepHandler
import acestep.core.generation.handler.init_service_downloads as downloads

# The library counts its LM among the "main model" parts and would download it (several GB) before running. This film
# does not use it, so the check only asks for what runs: the music model, the VAE and the text encoder (fetched with
# `hf download ACE-Step/Ace-Step1.5 --include "acestep-v15-turbo/*" "vae/*" "Qwen3-Embedding-0.6B/*" "config.json"`).
downloads.check_main_model_exists = lambda *_args, **_kw: True
from acestep.inference import GenerationParams, GenerationConfig, generate_music

os.makedirs(out, exist_ok=True)
dit = AceStepHandler()
msg, ok = dit.initialize_service(project_root=root, config_path="acestep-v15-turbo", device="cuda", offload_to_cpu=False)
if not ok:
    sys.exit(f"DiT init failed: {msg}")
# Restrained, precise and warm: a product film bed, not a trailer. No vocals, no ukulele.
CAPTION = (
    "minimal electronic instrumental for a software product film, 120 bpm, steady muted kick on beats one and three, "
    "soft analog synth bass, glassy plucked arpeggio, subtle bell motif, clean modern mix, confident and calm, "
    "builds gently, no vocals, no drops, no risers"
)
for seed in seeds:
    params = GenerationParams(caption=CAPTION, lyrics="[Instrumental]", instrumental=True, duration=84, bpm=120,
                              keyscale="A Minor", timesignature="4", seed=seed, inference_steps=8, shift=3.0,
                              thinking=False)
    config = GenerationConfig(batch_size=1, use_random_seed=False, audio_format="wav")
    result = generate_music(dit, None, params, config, save_dir=os.path.join(out, f"seed{seed}"))
    print(seed, result.success, result.audios[0]["path"] if result.success else result.error, flush=True)
