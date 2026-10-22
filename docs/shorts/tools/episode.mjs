// Builds one episode: a small data file (episodes/*.json) plus the templates make a complete HyperFrames project.
//   node tools/episode.mjs episodes/01-allow-or-deny.json [--here] [--out <dir>]
// Default output is build/<id>/ (a project of its own: compositions, tokens, fonts, the captures it uses and its audio).
// --here writes index.html into docs/shorts itself, which is how the committed example stays checkable.
// Needs `node tools/setup.mjs` once (captures, pets, icon).
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

const here = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const args = process.argv.slice(2)
const file = args.find(a => a.endsWith('.json'))
const outFlag = args.indexOf('--out')
if (!file) throw new Error('usage: node tools/episode.mjs <episode.json> [--here] [--out dir]')
const ep = JSON.parse(readFileSync(resolve(file), 'utf8'))
const out = args.includes('--here') ? here : outFlag >= 0 ? resolve(args[outFlag + 1]) : join(here, 'build', ep.id)
const TEMPLATES = { A: 'tpl-a', B: 'tpl-b', C: 'tpl-c', D: 'tpl-d', E: 'tpl-e' }
const tpl = TEMPLATES[ep.template]
if (!tpl) throw new Error('template must be one of A B C D E')
const D = ep.duration
const LOOP = ep.loop ?? 2
if (D < 12 || D > 30) console.warn(`note: ${D} s is outside the 12-30 s band`)

const cap = n => `assets/captures/${n}.jpg`
const pet = n => `assets/pets/${n}.png`
const used = new Set()
const useCapture = n => { used.add(cap(n)); return cap(n) }
const usePet = n => { used.add(pet(n)); return pet(n) }

// The template's variables: the episode's own words, with capture names turned into asset paths.
const vars = { ...ep.vars, duration: D, loop: LOOP }
const sfx = []
const add = (t, kind, more = {}) => sfx.push({ t: +t.toFixed(3), kind, ...more })
const count = (t, n, step) => { for (let i = 0; i < n; i++) add(t + i * step, 'tick') }

if (ep.template === 'A') {
	vars.captureUrl = useCapture(ep.vars.capture)
	delete vars.capture
	if (vars.countdown) count(vars.countdown.t, vars.countdown.n, vars.countdown.step)
	add(vars.answerAt, 'pop')
}
if (ep.template === 'B') {
	vars.topUrl = useCapture(ep.vars.captureTop)
	vars.bottomUrl = useCapture(ep.vars.captureBottom)
	delete vars.captureTop
	delete vars.captureBottom
	add(vars.revealAt, 'whoosh')
	add(vars.revealAt + 0.35, 'pop')
}
if (ep.template === 'C') {
	ep.vars.rounds.forEach((r, i) => {
		vars[`r${i + 1}e`] = useCapture(r.empty)
		vars[`r${i + 1}v`] = useCapture(r.verdict)
		count(r.reveal - 2.4, 3, 0.8)
		add(r.reveal, ({ deny: 'thud', allow: 'ok', ask: 'ask' })[r.result])
		if (i > 0) for (let k = 0; k < r.shown.length; k += 2) add(r.t + 0.35 + k * 0.03, 'type')
	})
	vars.rounds = ep.vars.rounds.map(({ empty, verdict, ...r }) => r)
}
if (ep.template === 'D' || ep.template === 'E') {
	vars.captureUrl = useCapture(ep.vars.capture)
	delete vars.capture
}
if (ep.template === 'D') {
	for (const b of vars.beats) {
		add(b.t, b.kind === 'reveal' ? 'pop' : 'tick')
		if (b.who) b.petUrl = usePet(b.who)
	}
}
if (ep.template === 'E') {
	vars.hops.forEach((h, i) => add(h.t, 'note', { pitch: i * 2 }))
}
for (const e of ep.sfx ?? []) add(e.t, e.kind, e)
add(D - LOOP, 'tick')
vars.petForTag = usePet(ep.tagPet ?? 'cat')

// Project files.
for (const d of ['assets/fonts', 'assets/captures', 'assets/pets', 'assets/audio', 'compositions']) mkdirSync(join(out, d), { recursive: true })
const copy = (from, to = from) => { if (resolve(here, from) !== resolve(out, to)) copyFileSync(join(here, from), join(out, to)) }
for (const f of ['assets/brand.css', 'assets/shorts.js', 'assets/blank.png', 'assets/icon.png', 'assets/fonts/instrument-sans-latin-wght-normal.woff2', 'assets/fonts/jetbrains-mono-latin-wght-normal.woff2', 'hyperframes.json', `compositions/${tpl}.html`, 'compositions/captions.html', 'compositions/tag.html']) {
	if (!existsSync(join(here, f))) throw new Error(`missing ${f}: run node tools/setup.mjs first`)
	copy(f)
}
for (const f of used) {
	if (!existsSync(join(here, f))) throw new Error(`missing ${f}: run node tools/setup.mjs first`)
	copy(f)
}

// Audio: the bed and the effects, composed in code. A voice (optional, the model's built-in Chatterbox voice) ducks the bed.
const work = join(out, 'assets', 'audio')
const cfgPath = join(work, 'sfx.json')
writeFileSync(cfgPath, JSON.stringify({ duration: D, bpm: ep.music?.bpm ?? 96, sfx: sfx.sort((a, b) => a.t - b.t) }, null, 1))
const py = process.platform === 'win32' ? 'python' : 'python3'
const voice = ep.voice ? resolve(ep.voice) : null
const sc = spawnSync(py, [join(here, 'tools', 'score.py'), cfgPath, work, ...(voice ? [voice] : [])], { stdio: 'inherit' })
if (sc.status !== 0) throw new Error('score.py failed')

// The root: timed hosts only. Every scene is a sub-composition; one caption track; one kind per track.
const attr = o => JSON.stringify(o).replace(/&/g, '&amp;').replace(/'/g, '&#39;')
const jsonVars = Object.fromEntries(Object.entries(vars).map(([k, v]) => [k, typeof v === 'object' ? JSON.stringify(v) : v]))
const tagVars = { duration: LOOP, pet: vars.petForTag }
delete jsonVars.petForTag
const host = (id, src, start, dur, track, kind, values) =>
	`<div id="${id}-host" data-composition-id="${id}" data-composition-src="${src}" data-start="${start}" data-duration="${dur}" data-track-index="${track}" data-track-kind="${kind}" data-width="1080" data-height="1920" data-variable-values='${attr(values)}'></div>`
const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=1080, height=1920">
<title>${ep.series ?? 'Dry Run'} ${ep.no ?? ''}: ${ep.title}</title>
<script src="https://cdn.jsdelivr.net/npm/gsap@3.14.2/dist/gsap.min.js"></script>
<link rel="stylesheet" href="assets/brand.css">
<script src="assets/shorts.js"></script>
<style>
html, body { margin: 0; width: 1080px; height: 1920px; overflow: hidden; background: #0c1020; }
#root { position: relative; width: 100%; height: 100%; overflow: hidden; background: linear-gradient(180deg, #182036 0%, #0c1020 38%); }
#root > div { position: absolute; inset: 0; }
</style>
</head>
<body>
<div id="root" data-composition-id="main" data-start="0" data-duration="${D}" data-width="1080" data-height="1920" data-fps="30">
${host(tpl, `compositions/${tpl}.html`, 0, D, 1, 'graphics', jsonVars)}
${host('tag', 'compositions/tag.html', +(D - LOOP).toFixed(2), LOOP, 3, 'graphics', tagVars)}
${host('captions', 'compositions/captions.html', 0, D - LOOP, 2, 'captions', { captions: JSON.stringify(ep.captions), duration: D - LOOP })}
<audio id="music" src="assets/audio/music.wav" data-start="0" data-duration="${D}" data-track-index="4" data-volume="${ep.music?.volume ?? 1}"></audio>
<audio id="sfx" src="assets/audio/sfx.wav" data-start="0" data-duration="${D}" data-track-index="5" data-volume="1"></audio>${voice ? `
<audio id="voice" src="assets/audio/voice.wav" data-start="0" data-duration="${D}" data-track-index="6" data-volume="1"></audio>` : ''}
</div>
<script>
const tl = gsap.timeline({ paused: true })
tl.to({}, { duration: ${D} }, 0)
window.__timelines["main"] = tl
</script>
</body>
</html>
`
writeFileSync(join(out, 'index.html'), html)
if (voice) copyFileSync(voice, join(work, 'voice.wav'))
writeFileSync(join(out, 'hyperframes.json'), readFileSync(join(here, 'hyperframes.json')))
console.log('wrote', join(out, 'index.html'))
