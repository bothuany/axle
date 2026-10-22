// Prepares the working assets that stay out of git: the captures (the app's own stills, as JPEG), the pets (cropped from the
// dock page's live take), the app icon, the 1x1 placeholder.
//   node tools/setup.mjs <capture dir> [<capture dir> ...] [--dock <dock-live.mp4>]
// A capture dir holds 3840x2160 PNGs of the app (docs/film/capture/workbench makes them). Default dirs, when none are
// given: the film's %LOCALAPPDATA%\Temp\insilode-film-v3\wb and insilode-shorts\wb-new.
import { copyFileSync, existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
import { tmpdir } from 'node:os'

const here = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const repo = resolve(here, '..', '..')
const argv = process.argv.slice(2)
const di = argv.indexOf('--dock')
const dock = di >= 0 ? argv.splice(di, 2)[1] : null
const temp = process.env.LOCALAPPDATA ? join(process.env.LOCALAPPDATA, 'Temp') : tmpdir()
const dirs = argv.length ? argv : [join(temp, 'insilode-film-v3', 'wb'), join(temp, 'insilode-shorts', 'wb-new')]
const ffmpeg = (...a) => { const r = spawnSync('ffmpeg', ['-v', 'error', '-y', ...a], { stdio: 'inherit' }); if (r.status !== 0) throw new Error('ffmpeg failed: ' + a.join(' ')) }

mkdirSync(join(here, 'assets', 'captures'), { recursive: true })
mkdirSync(join(here, 'assets', 'pets'), { recursive: true })
let n = 0
for (const d of dirs) {
	if (!existsSync(d)) { console.warn('skip (missing):', d); continue }
	for (const f of readdirSync(d).filter(f => /^[A-Z][A-Za-z0-9-]*\.png$/.test(f))) {
		const to = join(here, 'assets', 'captures', f.replace(/\.png$/, '.jpg'))
		if (!existsSync(to)) { ffmpeg('-i', join(d, f), '-q:v', '3', to); n++ }
	}
}
console.log(n, 'captures converted')

copyFileSync(join(repo, 'editor', 'branding', 'icon.png'), join(here, 'assets', 'icon.png'))
// The placeholder every picture slot starts with.
writeFileSync(join(here, 'assets', 'blank.png'), Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64'))

// The pets are real: the avatars of the Agents dock (cat for Claude, bunny for Codex, bear for others), cut from one frame of the
// dock page's live take (docs/film/capture/agents-live.mjs) and enlarged without smoothing.
const take = dock ?? join(temp, 'insilode-film-v3', 'shots', 'capture', 'dock-live.mp4')
if (existsSync(take)) {
	const frame = join(tmpdir(), 'insilode-dock-frame.png')
	ffmpeg('-ss', '12', '-i', take, '-frames:v', '1', frame)
	// 760x1072 frame at 2x: the avatars are 52 px squares at x 38; the rows start at y 98 (Codex), 350 (Claude), 841 (second Claude).
	for (const [name, y] of [['codex', 98], ['cat', 350], ['claude', 350]]) ffmpeg('-i', frame, '-vf', `crop=52:52:36:${y - 2},scale=208:208:flags=neighbor`, join(here, 'assets', 'pets', name + '.png'))
} else console.warn('no dock take: no pets (pass --dock <dock-live.mp4>)')
console.log('setup done')
