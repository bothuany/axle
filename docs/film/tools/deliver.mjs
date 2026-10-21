// Renders every variant headless and writes the small delivery files the README and the site use.
//   node deliver.mjs <shots dir> <repo media dir>     (media dir: docs/media/film)
// The film, the 1:1 and 9:16 cuts, the silent 15 s loop (MP4 and WebM), a poster, and per-feature silent clips
// cut from the film with stable names for the website.
import { spawnSync } from 'node:child_process'
import { mkdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

const [shots, media] = process.argv.slice(2)
const clips = join(media, 'clips')
mkdirSync(clips, { recursive: true })
const run = (cmd, args, cwd) => {
	const r = spawnSync(cmd, args, { cwd, stdio: 'inherit', shell: false })
	if (r.status !== 0) throw new Error(`${cmd} ${args.join(' ')} failed`)
}
const npx = process.platform === 'win32' ? 'npx.cmd' : 'npx'
const ff = (...args) => run('ffmpeg', ['-loglevel', 'error', '-y', ...args])
const master = v => join(shots, 'build', v, 'renders', `${v}.mp4`)

for (const v of ['film', 'square', 'vertical', 'loop']) {
	run(npx, ['hyperframes', 'render', '-o', `renders/${v}.mp4`, '--quality', 'delivery', '--video-frame-format', 'png', '--quiet'], join(shots, 'build', v))
}

// H.264 with the moov atom first so the page can start playing before it has the whole file.
const h264 = (src, dst, crf, audio = true, extra = []) =>
	ff('-i', src, ...extra, '-c:v', 'libx264', '-preset', 'slow', '-crf', String(crf), '-pix_fmt', 'yuv420p', '-movflags', '+faststart', ...(audio ? ['-c:a', 'aac', '-b:a', '160k'] : ['-an']), dst)

h264(master('film'), join(media, 'launch-film.mp4'), 22)
h264(master('square'), join(media, 'launch-film-1x1.mp4'), 23)
h264(master('vertical'), join(media, 'launch-film-9x16.mp4'), 23)
h264(master('loop'), join(media, 'loop-15s.mp4'), 28, false)
ff('-i', master('loop'), '-c:v', 'libvpx-vp9', '-b:v', '0', '-crf', '40', '-row-mt', '1', '-an', join(media, 'loop-15s.webm'))
// The poster: the change set at the turn, with its count in view (frame at 14.2 s).
ff('-ss', '14.2', '-i', master('film'), '-frames:v', '1', '-q:v', '3', join(media, 'launch-film-poster.jpg'))

// Per-feature clips, silent, from the film's picture (captions are part of the picture, so they stay).
const CLIPS = { 'change-set': [12, 10], 'across-services': [22, 8], tour: [30, 10], agents: [40, 14], diagrams: [54, 8] }
for (const [name, [start, dur]] of Object.entries(CLIPS)) h264(master('film'), join(clips, `${name}.mp4`), 26, false, ['-ss', String(start), '-t', String(dur)])
h264(master('loop'), join(clips, 'loop-15s.mp4'), 28, false)

for (const f of ['launch-film.mp4', 'launch-film-1x1.mp4', 'launch-film-9x16.mp4', 'loop-15s.mp4', 'loop-15s.webm', 'launch-film-poster.jpg']) console.log(f, (statSync(join(media, f)).size / 1e6).toFixed(1), 'MB')
