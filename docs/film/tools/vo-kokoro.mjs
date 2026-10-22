// Generates every voiceover line of vo/script.json with Kokoro-82M (Apache-2.0) through `hyperframes tts`, one WAV per
// line, then transcribes each for its word times (<id>.words.json, used for captions and timing).
//   HYPERFRAMES_PYTHON=<kokoro venv python> node vo-kokoro.mjs <shots dir> [line ids]
// The voice is the user's pick, bm_george. The spoken name comes from brand.json, so a rename re-runs line 10 only.
// A line may set `speed`, and `say` + `keepFrom` when Kokoro misreads it alone: Kokoro reads a lone "Where?" as
// "well", so it says "But where?" and the take is cut at the word "where".
import { readFileSync, renameSync, mkdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { launchSync } from '../../../scripts/lib.mjs'

const film = join(dirname(fileURLToPath(import.meta.url)), '..')
const [shots, ...only] = process.argv.slice(2)
const out = join(shots, 'vo')
mkdirSync(out, { recursive: true })
const brand = JSON.parse(readFileSync(join(film, 'brand.json'), 'utf8'))
const script = JSON.parse(readFileSync(join(film, 'vo', 'script.json'), 'utf8'))
const run = (cmd, args) => {
	const r = launchSync(cmd, args, { cwd: out, encoding: 'utf8' })
	if (r.status !== 0) throw new Error(`${cmd} ${args[0]} failed: ${r.stdout}${r.stderr}`)
	return r.stdout
}
// npx through the running Node: the Windows npx.cmd shim (nvm) looks for npm next to the working directory.
const NPX = join(dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npx-cli.js')
const hf = args => run(process.execPath, [NPX, 'hyperframes', ...args])
const transcribe = id => {
	hf(['transcribe', `${id}.wav`, '--json'])
	renameSync(join(out, 'transcript.json'), join(out, `${id}.words.json`))
	return JSON.parse(readFileSync(join(out, `${id}.words.json`), 'utf8'))
}

for (const line of script.lines) {
	if (only.length && !only.includes(line.id)) continue
	const text = (line.say ?? line.text).replace('{spokenName}', brand.spokenName)
	if (line.text.includes('{spokenName}') && brand.spokenPhonemes) {
		// The name goes in as phonemes (brand.json), so Kokoro stresses it as the brand says it.
		const tts = join(homedir(), '.cache', 'hyperframes', 'tts')
		run(process.env.HYPERFRAMES_PYTHON, ['-I', join(film, 'tools', 'kokoro-name.py'), join(tts, 'models', 'kokoro-v1.0.onnx'), join(tts, 'voices', 'voices-v1.0.bin'), `${line.id}.wav`, brand.spokenPhonemes, line.say ?? line.text])
	} else hf(['tts', text, '-v', 'bm_george', '-s', String(line.speed ?? 1), '-o', `${line.id}.wav`, '--json'])
	if (line.keepFrom) {
		const from = transcribe(line.id).find(w => w.text.toLowerCase().startsWith(line.keepFrom)).start
		renameSync(join(out, `${line.id}.wav`), join(out, `${line.id}.full.wav`))
		run('ffmpeg', ['-loglevel', 'error', '-y', '-i', `${line.id}.full.wav`, '-ss', String(Math.max(0, from - 0.03)), '-af', 'afade=t=in:d=0.02', `${line.id}.wav`])
	}
	const words = transcribe(line.id)
	console.log(line.id, words.at(-1).end.toFixed(2), 's |', words.map(w => w.text).join(' '))
}
