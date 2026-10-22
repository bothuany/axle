// Mixes the film's sound with ffmpeg: the voice lines at their times, the music bed (from the first frame, ducked under
// the voice, faded out at the end), and the effects; then loudness to about -14 LUFS with peaks under -1 dBTP.
//   node mix.mjs <shots dir> <music.wav>      writes <shots>/audio/mix.wav
import { spawnSync } from 'node:child_process'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { MUSIC, VO, sfx, timing } from './timing.mjs'

const [shots, music] = process.argv.slice(2)
const out = join(shots, 'audio')
mkdirSync(out, { recursive: true })
const t = timing(shots)
const inputs = []
const graph = []
const add = file => inputs.push('-i', file) && inputs.length / 2 - 1

// Voice: every line delayed to its start, then summed.
const voIds = Object.keys(VO)
voIds.forEach((id, i) => {
	const n = add(join(shots, 'vo', `${id}.wav`))
	const ms = Math.round(VO[id] * 1000)
	graph.push(`[${n}]aresample=48000,aformat=channel_layouts=stereo,adelay=${ms}|${ms}[v${i}]`)
})
graph.push(`${voIds.map((_, i) => `[v${i}]`).join('')}amix=inputs=${voIds.length}:normalize=0,apad=whole_dur=${MUSIC.end}[voice]`)
graph.push(`[voice]asplit=2[voiceOut][voiceKey]`)

// Music: runs with the film from MUSIC.in and fades out at the end.
const m = add(music)
const { in: mIn, end } = MUSIC
graph.push(`[${m}]aresample=48000,aformat=channel_layouts=stereo,atrim=0:${end - mIn},adelay=${mIn * 1000}|${mIn * 1000},` +
	`afade=t=in:st=${mIn}:d=0.4,afade=t=out:st=${end - 2.5}:d=2.5,volume=0.55,apad=whole_dur=${end}[bed]`)
// Ducking: the bed drops about 8 dB while the voice speaks.
graph.push(`[bed][voiceKey]sidechaincompress=threshold=0.03:ratio=6:attack=20:release=350:makeup=1[ducked]`)

// Effects.
const events = sfx(t)
events.forEach(([name, time, gain], i) => {
	const n = add(join(shots, 'audio', 'sfx', `${name}.wav`))
	const ms = Math.round(time * 1000)
	graph.push(`[${n}]volume=${gain},adelay=${ms}|${ms}[s${i}]`)
})
graph.push(`${events.map((_, i) => `[s${i}]`).join('')}amix=inputs=${events.length}:normalize=0,apad=whole_dur=${end}[fx]`)

graph.push(`[voiceOut][ducked][fx]amix=inputs=3:normalize=0,atrim=0:${end},loudnorm=I=-14:TP=-1.5:LRA=9[mix]`)
const r = spawnSync('ffmpeg', ['-loglevel', 'error', '-y', ...inputs, '-filter_complex', graph.join(';'), '-map', '[mix]', '-ar', '48000', '-c:a', 'pcm_s16le', join(out, 'mix.wav')], { stdio: 'inherit' })
process.exit(r.status ?? 1)
