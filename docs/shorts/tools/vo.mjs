// Voices one episode: one take per line of the episode's `vo` block, made locally with Chatterbox (tools/vo.py), then
// trimmed, stretched to the line's tempo (rubberband, pitch and formants kept), normalized, transcribed for its word
// times and placed at the line's `t` on one voice track.
//   node tools/vo.mjs episodes/<id>.json [--fresh] [id ...]
// Writes work/<id>/voice.wav (48 kHz mono, 16 bit) and work/<id>/vo.json (every line with its placed words), which
// tools/episode.mjs reads for the captions and the duck. Takes are cached by their settings; --fresh (or line ids)
// makes them again. The Chatterbox venv's python is INSILODE_TTS_PYTHON, by default ~/insilode-tts/chatterbox-venv.
// A `ref` may name environment variables as %NAME% (the film's reference lives under %LOCALAPPDATA%\Temp).
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

const here = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const args = process.argv.slice(2)
const file = args.find(a => a.endsWith('.json'))
if (!file) throw new Error('usage: node tools/vo.mjs <episode.json> [--fresh] [line id ...]')
const fresh = args.includes('--fresh')
const only = args.filter(a => !a.endsWith('.json') && !a.startsWith('--'))
const ep = JSON.parse(readFileSync(resolve(file), 'utf8'))
if (!ep.vo) throw new Error(`${ep.id} has no vo block`)
const SR = 48000
const work = join(here, 'work', ep.id)
for (const d of ['raw', 'lines']) mkdirSync(join(work, d), { recursive: true })
const python = process.env.INSILODE_TTS_PYTHON ?? join(homedir(), 'insilode-tts', 'chatterbox-venv', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python')
const NPX = join(dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npx-cli.js')
const env = s => s && s.replace(/%([A-Z_]+)%/g, (_, k) => process.env[k] ?? '')
const run = (cmd, a, opts = {}) => {
	const r = spawnSync(cmd, a, { encoding: 'utf8', ...opts })
	if (r.status !== 0) throw new Error(`${cmd} ${a.join(' ')}: ${r.stderr || r.stdout}`)
	return r.stdout
}
const ff = a => run('ffmpeg', ['-loglevel', 'error', '-y', ...a])

// 1. The takes: the line's text (or its `say` spelling) in its speaker's voice and settings.
const takes = ep.vo.lines.map(l => {
	const v = ep.vo.voices[l.who ?? 'narrator']
	if (!v) throw new Error(`line ${l.id}: no voice "${l.who}"`)
	const ref = env(v.ref ?? null)
	if (ref && !existsSync(ref)) throw new Error(`line ${l.id}: reference ${ref} is missing`)
	const take = { id: l.id, text: l.say ?? l.text.replace(/\*/g, ''), ref, exaggeration: l.exaggeration ?? v.exaggeration, cfg: l.cfg ?? v.cfg, seed: l.seed ?? v.seed, temperature: v.temperature ?? 0.8 }
	take.hash = createHash('sha1').update(JSON.stringify(take)).digest('hex').slice(0, 12)
	return take
})
const stale = takes.filter(t => fresh || only.includes(t.id) || !existsSync(join(work, 'raw', `${t.id}.wav`)) || !existsSync(join(work, 'raw', `${t.id}.${t.hash}`)))
if (stale.length) {
	if (!existsSync(python)) throw new Error(`no Chatterbox python at ${python} (set INSILODE_TTS_PYTHON)`)
	writeFileSync(join(work, 'takes.json'), JSON.stringify({ takes: stale }, null, 1))
	const r = spawnSync(python, ['-I', join(here, 'tools', 'vo.py'), join(work, 'takes.json'), join(work, 'raw')], { stdio: 'inherit' })
	if (r.status !== 0) throw new Error('vo.py failed')
	for (const t of stale) writeFileSync(join(work, 'raw', `${t.id}.${t.hash}`), '')
}

// 2. Finish each line and transcribe it.
const TRIM = 'silenceremove=start_periods=1:start_threshold=-45dB:start_silence=0.03,areverse,silenceremove=start_periods=1:start_threshold=-45dB:start_silence=0.1,areverse'
const transcribe = wav => {
	const dir = join(work, 'asr')
	mkdirSync(dir, { recursive: true })
	run(process.execPath, [NPX, 'hyperframes', 'transcribe', wav, '--json', '-d', dir])
	return JSON.parse(readFileSync(join(dir, 'transcript.json'), 'utf8'))
}
const readWav = path => {
	// A 16-bit PCM wav as written by ffmpeg: find the data chunk.
	const b = readFileSync(path)
	let o = 12
	while (o < b.length) {
		const id = b.toString('ascii', o, o + 4), size = b.readUInt32LE(o + 4)
		if (id === 'data') return new Int16Array(b.buffer.slice(b.byteOffset + o + 8, b.byteOffset + o + 8 + size))
		o += 8 + size + (size & 1)
	}
	throw new Error('no data chunk in ' + path)
}
const placed = []
for (const l of ep.vo.lines) {
	const out = join(work, 'lines', `${l.id}.wav`)
	const stretch = l.tempo && l.tempo !== 1 ? `rubberband=tempo=${l.tempo}:transients=smooth:formant=preserved:pitchq=quality,` : ''
	// A gentle compressor first: a take can get 6 dB hotter on one phrase, and the line's loudness alone does not
	// even that out.
	const comp = 'acompressor=threshold=-24dB:ratio=3:attack=8:release=150:makeup=1'
	ff(['-i', join(work, 'raw', `${l.id}.wav`), '-af', `${TRIM},aresample=${SR},${stretch}${comp},loudnorm=I=-16:TP=-1.5:LRA=7,aresample=${SR}`, '-ac', '1', '-ar', String(SR), '-c:a', 'pcm_s16le', out])
	const words = transcribe(out)
	const pcm = readWav(out)
	const dur = pcm.length / SR
	placed.push({ id: l.id, who: l.who ?? 'narrator', t: l.t, dur: +dur.toFixed(3), text: l.text, words: words.map(w => ({ text: w.text, start: +(l.t + w.start).toFixed(3), end: +(l.t + w.end).toFixed(3) })), pcm })
	const n = l.text.replace(/\*/g, '').split(/\s+/).filter(Boolean).length
	console.log(l.id.padEnd(4), `${l.t.toFixed(2)}-${(l.t + dur).toFixed(2)}`.padEnd(12), (n / Math.max(0.1, words.at(-1).end - words[0].start)).toFixed(2), 'w/s |', words.map(w => w.text).join(' '))
}

// 3. Place every line on one track; warn when two overlap.
placed.sort((a, b) => a.t - b.t)
placed.forEach((p, i) => { const nx = placed[i + 1]; if (nx && p.t + p.dur > nx.t) console.warn(`overlap: ${p.id} ends ${(p.t + p.dur).toFixed(2)} after ${nx.id} starts ${nx.t}`) })
const D = ep.duration
const mix = new Float32Array(Math.ceil(D * SR))
for (const p of placed) {
	const at = Math.round(p.t * SR)
	for (let i = 0; i < p.pcm.length && at + i < mix.length; i++) mix[at + i] += p.pcm[i] / 32768
	if (p.t + p.dur > D) console.warn(`${p.id} runs past the end (${(p.t + p.dur).toFixed(2)} > ${D})`)
}
const data = Buffer.alloc(mix.length * 2)
for (let i = 0; i < mix.length; i++) data.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(mix[i] * 32767))), i * 2)
const head = Buffer.alloc(44)
head.write('RIFF', 0); head.writeUInt32LE(36 + data.length, 4); head.write('WAVE', 8); head.write('fmt ', 12)
head.writeUInt32LE(16, 16); head.writeUInt16LE(1, 20); head.writeUInt16LE(1, 22); head.writeUInt32LE(SR, 24)
head.writeUInt32LE(SR * 2, 28); head.writeUInt16LE(2, 32); head.writeUInt16LE(16, 34); head.write('data', 36); head.writeUInt32LE(data.length, 40)
writeFileSync(join(work, 'voice.wav'), Buffer.concat([head, data]))
writeFileSync(join(work, 'vo.json'), JSON.stringify({ id: ep.id, duration: D, lines: placed.map(({ pcm, ...p }) => p) }, null, 1))
const spoken = placed.reduce((s, p) => s + p.text.split(/\s+/).length, 0)
const span = placed.at(-1).words.at(-1).end - placed[0].words[0].start
console.log(`${spoken} words over ${span.toFixed(1)} s (${(spoken / span * 60).toFixed(0)} wpm with the pauses); wrote ${join(work, 'voice.wav')}`)
