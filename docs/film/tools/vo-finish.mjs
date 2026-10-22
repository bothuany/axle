// Turns the raw takes (tools/vo.py, <shots>/vo/raw/<id>.wav) into the film's lines: trims the silence, opens the pauses
// script.json asks for (after a word, from a first transcript), stretches the line to a calm pace with rubberband
// (pitch and formants kept, `tempo` below 1 is slower), normalizes it to -16 LUFS and transcribes it for its word times.
//   node vo-finish.mjs <shots dir> [id ...]      writes <shots>/vo/<id>.wav and <id>.words.json
import { spawnSync } from 'node:child_process'
import { readFileSync, renameSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const film = join(dirname(fileURLToPath(import.meta.url)), '..')
const [shots, ...only] = process.argv.slice(2)
const dir = join(shots, 'vo')
const script = JSON.parse(readFileSync(join(film, 'vo', 'script.json'), 'utf8'))
// npx through the running Node: the Windows npx.cmd shim (nvm) looks for npm next to the working directory.
const NPX = join(dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npx-cli.js')
const run = (cmd, args) => {
	const r = spawnSync(cmd, args, { cwd: dir, encoding: 'utf8' })
	if (r.status !== 0) throw new Error(`${cmd} ${args.join(' ')}: ${r.stderr}`)
}
const ff = args => run('ffmpeg', ['-loglevel', 'error', '-y', ...args])
const transcribe = (wav, to) => {
	run(process.execPath, [NPX, 'hyperframes', 'transcribe', wav, '--json'])
	renameSync(join(dir, 'transcript.json'), join(dir, to))
	return JSON.parse(readFileSync(join(dir, to), 'utf8'))
}
const TRIM = 'silenceremove=start_periods=1:start_threshold=-45dB:start_silence=0.05,areverse,silenceremove=start_periods=1:start_threshold=-45dB:start_silence=0.12,areverse'

for (const line of script.lines) {
	if (only.length && !only.includes(line.id)) continue
	const id = line.id
	ff(['-i', `raw/${id}.wav`, '-af', `${TRIM},aresample=48000`, '-ac', '1', `${id}.trim.wav`])
	let src = `${id}.trim.wav`
	if (line.pauses?.length) {
		// Silence inserted between a word's end and the next word's start, where the first transcript puts them.
		const words = transcribe(src, `${id}.trim.words.json`)
		const cuts = line.pauses.map(([word, sec]) => {
			const i = words.findIndex(w => w.text.toLowerCase().replace(/[^a-z']/g, '').startsWith(word))
			if (i < 0 || i === words.length - 1) throw new Error(`${id}: no word "${word}" to pause after`)
			return [(words[i].end + words[i + 1].start) / 2, sec]
		}).sort((a, b) => a[0] - b[0])
		const parts = []
		let from = 0
		cuts.forEach(([t, sec], i) => {
			parts.push(`[0]atrim=${from}:${t},asetpts=PTS-STARTPTS[p${i}]`, `anullsrc=r=48000:cl=mono,atrim=0:${sec}[g${i}]`)
			from = t
		})
		parts.push(`[0]atrim=${from},asetpts=PTS-STARTPTS[p${cuts.length}]`)
		const order = cuts.map((_, i) => `[p${i}][g${i}]`).join('') + `[p${cuts.length}]`
		ff(['-i', src, '-filter_complex', `${parts.join(';')};${order}concat=n=${cuts.length * 2 + 1}:v=0:a=1[o]`, '-map', '[o]', `${id}.paused.wav`])
		src = `${id}.paused.wav`
	}
	const stretch = line.tempo ? `rubberband=tempo=${line.tempo}:transients=smooth:formant=preserved:pitchq=quality,` : ''
	ff(['-i', src, '-af', `${stretch}loudnorm=I=-16:TP=-1.5:LRA=11,aresample=48000`, '-ac', '1', '-ar', '48000', `${id}.wav`])
	const words = transcribe(`${id}.wav`, `${id}.words.json`)
	const spoken = line.text.split(/\s+/).length
	const span = words.at(-1).end - words[0].start
	console.log(id.padEnd(6), (spoken / span).toFixed(2), 'w/s', words.at(-1).end.toFixed(2), 's |', words.map(w => w.text).join(' '))
}
