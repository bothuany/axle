# Composes and synthesizes the film's music bed in code: no model, no samples, nothing downloaded.
#   python score.py <out.wav>
# 120 BPM in A minor, one bar = 2 s, so every cut of the film lands on a downbeat. The bed starts at its own 0 on the
# film's turn (12.0 s, tools/timing.mjs MUSIC.in) and runs 68 s: a quiet pulse that grows with the proofs, thins
# for the montage, drops to the bass under the held frame and resolves on a bell motif with the logo (film 74.0 s).
import sys

import numpy as np

SR = 48000
BPM = 120
BEAT = 60 / BPM
BAR = 4 * BEAT
LENGTH = 68.0
N = int(LENGTH * SR)
rng = np.random.default_rng(7)

# Chords per bar, two bars each: Am  F  C  G (the loop of the film), as MIDI roots and triads.
PROGRESSION = [(57, [57, 60, 64]), (53, [53, 57, 60]), (48, [48, 52, 55]), (55, [55, 59, 62])]


def hz(midi):
    return 440.0 * 2 ** ((midi - 69) / 12)


def chord_at(t):
    return PROGRESSION[int(t // (2 * BAR)) % len(PROGRESSION)]


def env(n, attack, release, sustain=None):
    a = max(1, int(attack * SR))
    e = np.ones(n)
    e[:a] = np.linspace(0, 1, a)
    if sustain is None:
        tail = np.exp(-np.arange(n - a) / (release * SR))
        e[a:] = tail
    return e


def onepole(x, cutoff):
    """A gentle low-pass, so the saws are warm, not buzzy."""
    a = np.exp(-2 * np.pi * cutoff / SR)
    y = np.empty_like(x)
    acc = 0.0
    for i, v in enumerate(x):
        acc = (1 - a) * v + a * acc
        y[i] = acc
    return y


def place(buf, start, sig, gain=1.0):
    i = int(start * SR)
    if i >= len(buf):
        return
    j = min(len(buf), i + len(sig))
    buf[i:j] += sig[: j - i] * gain


def saw(f, n, harmonics=8):
    t = np.arange(n) / SR
    return sum(np.sin(2 * np.pi * f * k * t) / k for k in range(1, harmonics + 1))


def kick(n=int(0.45 * SR)):
    t = np.arange(n) / SR
    f = 45 + 75 * np.exp(-t * 28)
    return np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t * 7.5)


def hat(n=int(0.05 * SR)):
    x = rng.standard_normal(n)
    # Band-limited (6-9 kHz), so the hats tick instead of hiss.
    x = onepole(x - onepole(x, 6000), 9000)
    return x * np.exp(-np.arange(n) / (0.010 * SR))


def pluck(f, dur=0.35):
    """Karplus-Strong string: a glassy pluck for the arpeggio."""
    n = int(dur * SR)
    period = max(2, int(SR / f))
    buf = rng.uniform(-1, 1, period)
    out = np.empty(n)
    for i in range(n):
        out[i] = buf[i % period]
        buf[i % period] = 0.497 * (buf[i % period] + buf[(i + 1) % period])
    return out * env(n, 0.002, dur / 3)


def bell(f, dur=2.4):
    t = np.arange(int(dur * SR)) / SR
    mod = np.sin(2 * np.pi * f * 3.5 * t) * 2.2 * np.exp(-t * 3)
    return np.sin(2 * np.pi * f * t + mod) * np.exp(-t * 1.6)


kicks = np.zeros(N)
hats = np.zeros(N)
bass = np.zeros(N)
arp = np.zeros(N)
pad = np.zeros(N)
bells = np.zeros(N)

# Sections in bed seconds (film = bed + 12): build, full, thin, held, resolve.
for b in range(int(LENGTH / BEAT)):
    t = b * BEAT
    held = 56 <= t < 60
    if b % 2 == 0 and not held and t < 62:
        place(kicks, t, kick(), 0.9 if t >= 8 else 0.6)
    if 8 <= t < 56 and not held:
        for s in (0, BEAT / 2):
            place(hats, t + s, hat(), 0.05 if s else 0.03)

# Bass: eighth-note pulse on the chord root, two octaves down; alone under the held frame.
for k in range(int(LENGTH / (BEAT / 2))):
    t = k * BEAT / 2
    if t >= 62:
        break
    root, _ = chord_at(t)
    n = int(BEAT / 2 * SR * 0.9)
    tone = onepole(saw(hz(root - 24), n, 6), 380) * env(n, 0.005, 0.18)
    place(bass, t, tone, 0.55 if k % 2 == 0 else 0.35)

# Arpeggio: sixteenths over the chord tones, from the turn's first proof to the montage.
pattern = [0, 1, 2, 1, 2, 0, 1, 2]
for k in range(int(LENGTH / (BEAT / 4))):
    t = k * BEAT / 4
    if not (8 <= t < 50):
        continue
    _, triad = chord_at(t)
    note = triad[pattern[k % len(pattern)]] + 12
    place(arp, t, pluck(hz(note)), 0.22 if 18 <= t < 42 else 0.14)

# Pad: soft detuned saws on each chord, the floor under everything.
for c in range(int(LENGTH / (2 * BAR)) + 1):
    t = c * 2 * BAR
    _, triad = chord_at(t)
    n = int(2 * BAR * SR)
    tone = sum(onepole(saw(hz(m) * d, n, 5), 1100) for m in triad for d in (0.997, 1.003))
    e = np.minimum(1, np.minimum(np.arange(n) / (0.6 * SR), (n - np.arange(n)) / (0.6 * SR)))
    gain = 0.035 if t < 56 else 0.05
    place(pad, t, tone * e, gain)

# The bell motif: E5 A5 C6, once when the canvas first appears and again, resolving, on the logo (bed 62 s).
for start, notes in ((0.0, [76, 81]), (62.0, [76, 81, 84, 81])):
    for i, m in enumerate(notes):
        place(bells, start + i * BEAT, bell(hz(m)), 0.16)
# Final chord rings out under the CTA.
n = int(6 * SR)
tone = sum(onepole(saw(hz(m), n, 5), 900) for m in (57, 60, 64, 69))
place(pad, 62, tone * env(n, 0.3, 2.5), 0.05)

mix = kicks * 0.8 + hats + bass + arp + pad + bells
# A little room: a short feedback delay on the arp and bells, so the bed is not dry.
wet = np.zeros(N)
for d, g in ((0.375, 0.28), (0.75, 0.14)):
    k = int(d * SR)
    wet[k:] += (arp + bells)[:-k] * g
mix += wet
fade = np.ones(N)
fade[-int(3 * SR):] = np.linspace(1, 0, int(3 * SR))
mix *= fade
mix /= np.max(np.abs(mix)) * 1.12
stereo = np.stack([mix, np.roll(mix, int(0.004 * SR))], axis=1)

import wave

with wave.open(sys.argv[1], "wb") as w:
    w.setnchannels(2)
    w.setsampwidth(2)
    w.setframerate(SR)
    w.writeframes((stereo * 32767).astype("<i2").tobytes())
print("wrote", sys.argv[1], LENGTH, "s")
