# Says a voice line whose product name Kokoro would stress wrongly: the text around {spokenName} is phonemized as
# usual (en-gb) and the name goes in as the phonemes from brand.json, so "Insilode" is IN-sih-lohd, not in-SY-lode.
#   python -I kokoro-name.py <kokoro model.onnx> <voices.bin> <out.wav> <name phonemes> <text with {spokenName}>
import sys

import soundfile
from kokoro_onnx import Kokoro
from kokoro_onnx.tokenizer import Tokenizer

model_path, voices_path, out, name, text = sys.argv[1:6]
tokenizer = Tokenizer()
pieces = text.split("{spokenName}")
phonemes = name.join(tokenizer.phonemize(p, "en-gb") if p.strip() else p for p in pieces)
samples, rate = Kokoro(model_path, voices_path).create(phonemes, voice="bm_george", lang="en-gb", is_phonemes=True)
soundfile.write(out, samples, rate)
sys.stdout.buffer.write((phonemes + "\n").encode("utf-8"))
