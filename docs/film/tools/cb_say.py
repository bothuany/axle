# Generates one line with Chatterbox on the GPU: cb_say.py <out.wav> <text> [exaggeration] [cfg] [ref.wav]
import sys, torch, soundfile
from chatterbox.tts import ChatterboxTTS
out, text = sys.argv[1], sys.argv[2]
exag = float(sys.argv[3]) if len(sys.argv) > 3 else 0.5
cfg = float(sys.argv[4]) if len(sys.argv) > 4 else 0.5
ref = sys.argv[5] if len(sys.argv) > 5 else None
torch.manual_seed(7)
m = ChatterboxTTS.from_pretrained(device="cuda")
wav = m.generate(text, exaggeration=exag, cfg_weight=cfg, audio_prompt_path=ref)
soundfile.write(out, wav.squeeze(0).cpu().numpy(), m.sr)
print(out, wav.shape[-1] / m.sr, "s", torch.cuda.get_device_name(0))
