# Composes the music bed and the sound effects of one short, in code: NumPy and the standard library, no model, no samples,
# nothing downloaded (the same rule as docs/film/tools/score.py, which this is the short version of).
#   python -I score.py <sfx.json> <out dir> [voice.wav]
# sfx.json: {"duration": 17, "bpm": 96, "sfx": [{"t": 3.2, "kind": "thud"}, ...]}
# kinds: tick, type, thud, ok, ask, note (with "pitch": 0..7), pop, whoosh.
# Writes <out dir>/music.wav and <out dir>/sfx.wav (48 kHz stereo, 16 bit). The bed is ducked under the voice if one is
# given (a 48 kHz mono or stereo wav), thins out in the 2.4 s before every reveal (the guess) and lands on it.
import json
import sys
import wave

import numpy as np

SR = 48000
rng = np.random.default_rng(11)
cfg = json.load(open(sys.argv[1], encoding="utf-8"))
out = sys.argv[2].rstrip("/\\")
voice_path = sys.argv[3] if len(sys.argv) > 3 else None
LENGTH = float(cfg["duration"])
BPM = float(cfg.get("bpm", 96))
BEAT = 60.0 / BPM
N = int(LENGTH * SR)
REVEALS = [e["t"] for e in cfg["sfx"] if e["kind"] in ("thud", "ok", "ask", "pop")]

# Am  F  C  G, two beats of each chord's root per bar; triads as MIDI notes.
PROG = [(45, [57, 60, 64]), (41, [53, 57, 60]), (36, [48, 52, 55]), (43, [55, 59, 62])]


def hz(m):
    return 440.0 * 2 ** ((m - 69) / 12)


def place(buf, t, sig, gain=1.0):
    i = int(t * SR)
    if i >= len(buf) or i < 0:
        return
    j = min(len(buf), i + len(sig))
    buf[i:j] += sig[: j - i] * gain


def tt(n):
    return np.arange(n) / SR


def lowpass(x, cutoff):
    a = np.exp(-2 * np.pi * cutoff / SR)
    y = np.empty_like(x)
    acc = 0.0
    for i, v in enumerate(x):
        acc = (1 - a) * v + a * acc
        y[i] = acc
    return y


def pluck(f, dur=0.45):
    t = tt(int(dur * SR))
    s = sum(np.sin(2 * np.pi * f * k * t) / (k * k) for k in (1, 2, 3, 4))
    return s * np.exp(-t * 7.0) * np.minimum(1, t / 0.004)


def pad_note(f, n):
    t = tt(n)
    s = sum(np.sin(2 * np.pi * f * d * t) for d in (0.998, 1.002)) + 0.4 * np.sin(2 * np.pi * f * 2 * t)
    e = np.minimum(1, np.minimum(t / 0.8, (n / SR - t) / 0.8))
    return s * e


# The bed.
bass = np.zeros(N)
arp = np.zeros(N)
pad = np.zeros(N)
bar = 4 * BEAT
for k in range(int(LENGTH / bar) + 1):
    t0 = k * bar
    root, triad = PROG[k % len(PROG)]
    n = int(bar * SR)
    for m in triad:
        place(pad, t0, pad_note(hz(m), n), 0.05)
    for b in (0, 2):
        place(bass, t0 + b * BEAT, pluck(hz(root), 0.9), 0.5)
    for s in range(8):
        note = triad[[0, 1, 2, 1, 2, 1, 0, 1][s]] + (12 if s % 2 == 0 else 0)
        place(arp, t0 + s * BEAT / 2, pluck(hz(note) , 0.35), 0.16)

# The guess: the bed thins to the pad in the 2.4 s before a reveal, and the arpeggio comes back on it.
gain = np.ones(N)
for r in REVEALS:
    a, b = int((r - 2.4) * SR), int(r * SR)
    if a < 0:
        a = 0
    gain[a:b] = np.minimum(gain[a:b], 0.18)
    ramp = int(0.08 * SR)
    gain[max(0, a - ramp):a] = np.minimum(gain[max(0, a - ramp):a], np.linspace(1, 0.18, len(gain[max(0, a - ramp):a])))
bed = pad + (bass + arp) * gain
# The first second is already moving, not a sting; the last 1.2 s thin out for the loop.
fade = np.ones(N)
fade[-int(1.2 * SR):] = np.linspace(1, 0.55, int(1.2 * SR))
bed *= fade

if voice_path:
    with wave.open(voice_path) as w:
        raw = np.frombuffer(w.readframes(w.getnframes()), dtype="<i2").astype(float) / 32768
        if w.getnchannels() == 2:
            raw = raw.reshape(-1, 2).mean(axis=1)
    env = np.zeros(N)
    env[: min(N, len(raw))] = np.abs(raw[:N])
    win = int(0.12 * SR)
    env = np.convolve(env, np.ones(win) / win, mode="same")
    env = np.minimum(1, env / (np.percentile(env[env > 0], 90) if (env > 0).any() else 1))
    env = np.convolve(env, np.ones(int(0.25 * SR)) / int(0.25 * SR), mode="same")
    bed *= 1 - 0.65 * env  # about -9 dB under speech

bed = bed / (np.max(np.abs(bed)) * 1.05) * 0.85

# Sound effects.
fx = np.zeros(N)


def tick(f=2600, d=0.03):
    t = tt(int(d * SR))
    return np.sin(2 * np.pi * f * t) * np.exp(-t * 180)


def thud():
    n = int(0.55 * SR)
    t = tt(n)
    f = 46 + 90 * np.exp(-t * 26)
    body = np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t * 7)
    knock = rng.standard_normal(int(0.05 * SR))
    knock = knock * np.exp(-np.arange(len(knock)) / (0.008 * SR))
    body[: len(knock)] += lowpass(knock, 1800) * 0.8
    return body


def bell(f, d=0.7):
    t = tt(int(d * SR))
    return (np.sin(2 * np.pi * f * t) + 0.35 * np.sin(2 * np.pi * f * 2.76 * t)) * np.exp(-t * 6.5) * np.minimum(1, t / 0.003)


def whoosh():
    n = int(0.5 * SR)
    x = rng.standard_normal(n)
    x = lowpass(x, 900) - lowpass(x, 120)
    e = np.sin(np.pi * np.arange(n) / n) ** 2
    return x * e * 2.5


PENTA = [57, 60, 62, 64, 67, 69, 72, 74]
for e in cfg["sfx"]:
    t, k = e["t"], e["kind"]
    if k == "tick":
        place(fx, t, tick(), 0.35)
    elif k == "type":
        place(fx, t, tick(3400, 0.012), 0.16)
    elif k == "thud":
        place(fx, t, thud(), 0.95)
    elif k == "ok":
        place(fx, t, bell(hz(76)), 0.4)
        place(fx, t + 0.11, bell(hz(83)), 0.4)
    elif k == "ask":
        place(fx, t, bell(hz(72)), 0.4)
        place(fx, t + 0.16, bell(hz(72)), 0.3)
    elif k == "note":
        place(fx, t, bell(hz(PENTA[int(e.get("pitch", 0)) % len(PENTA)] + 12), 0.9), 0.5)
    elif k == "pop":
        place(fx, t, tick(900, 0.09), 0.5)
    elif k == "whoosh":
        place(fx, t, whoosh(), 0.35)
fx = fx / max(1e-6, np.max(np.abs(fx))) * 0.85 if np.max(np.abs(fx)) > 0 else fx


def write(path, mono):
    st = np.stack([mono, np.roll(mono, int(0.003 * SR))], axis=1)
    with wave.open(path, "wb") as w:
        w.setnchannels(2)
        w.setsampwidth(2)
        w.setframerate(SR)
        w.writeframes((np.clip(st, -1, 1) * 32767).astype("<i2").tobytes())


write(out + "/music.wav", bed)
write(out + "/sfx.wav", fx)
print("wrote", out, LENGTH, "s,", len(cfg["sfx"]), "effects,", len(REVEALS), "reveals")
