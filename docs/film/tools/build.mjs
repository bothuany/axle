// Writes the film's HyperFrames projects from one scene spec: the 16:9 launch film, its 1:1 and 9:16 cuts and the
// silent 15 s loop. Every picture is a capture of the editor in web mode (capture/workbench-film.mjs) or the dock page
// (capture/agents-live.mjs); this file only frames them (the camera), rings what the voice names, sets type and
// captions, and places the mix.
//   node build.mjs <shots dir> [variants]
// reads <shots>/wb (the 3840x2160 window stills), <shots>/capture/dock-live.mp4, <shots>/vo, <shots>/audio/mix.wav and
// writes <shots>/build/<variant>/ (index.html + assets), ready for `hyperframes render`.
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { VO, timing } from './timing.mjs'

const film = join(dirname(fileURLToPath(import.meta.url)), '..')
const shots = process.argv[2]
const brand = JSON.parse(readFileSync(join(film, 'brand.json'), 'utf8'))
const script = JSON.parse(readFileSync(join(film, 'vo', 'script.json'), 'utf8'))
const line = id => script.lines.find(l => l.id === id).text.replace('{productName}', brand.productName)
const { at, voEnd } = timing(shots)
// The slogan in two lines, the name in the signal blue (the site's --link).
const slogan = brand.headline.replace(/\. /, '.<br>').replace('{productName}', `<span class="nm">${brand.productName}</span>`)

// Every still is the same window at 2x: 3840x2160 image px = 1920x1080 CSS px.
const IW = 3840, IH = 2160
const STILLS = ['A1-editor', 'A2-extensions', 'A3-themes', 'A4-keys', 'B1-sidebar', 'B2-sidebar', 'B3-sidebar', 'C1-commit', 'C2-pick', 'C3-changes', 'C4-place', 'D-base', 'E-harness']
// The dock page recorded live with its scripted session (capture/agents-live.mjs): 760x1072 px at 2x, so 380 CSS px
// wide, the width of the dock in the window's right side bar. It is laid exactly over that dock (image px below).
const DOCK = { src: 'capture/dock-live.mp4', x: 3084, y: 200, w: 760, h: 1072, bg: '#111111', pane: [3082, 140, 838, 1972] }

const FORMATS = {
	film: { w: 1920, h: 1080, duration: 62 },
	square: { w: 1080, h: 1080, duration: 62 },
	vertical: { w: 1080, h: 1920, duration: 62 },
	loop: { w: 1920, h: 1080, duration: 15, silent: true },
}

// A camera key: the region of the window (fractions x0, y0, x1, y1; may reach past the window to show the stage)
// that must fit the frame's picture area. `focus` is the point the narrow cuts (1:1, 9:16) centre on, and `zoom` how
// much tighter they frame than the wide one (a full-window rect would leave the text unreadable in 9:16).
const key = (t, rect, more = {}) => ({ t, rect, ...more })
// The whole window on the stage at `k` of the picture width. The film's picture area is 1920 x 907 (the band below
// holds the captions), which is 0.84 of the window's height per unit of width.
const whole = (k = 0.84) => { const w = 1 / k, h = 0.84 / k; return [0.5 - w / 2, 0.5 - h / 2, 0.5 + w / 2, 0.5 + h / 2] }

function shotList() {
	const s = []
	// 01 The editor: the whole window, a slow push.
	s.push({ id: 's01', img: 'A1-editor', start: 0, dur: 5, keys: [key(0, whole(0.8), { focus: [0.3, 0.4] }), key(5, whole(0.86), { focus: [0.3, 0.4] })] })
	// 02 What carries over: the side bar switches to Extensions (Open VSX), themes, then the Keyboard Shortcuts editor.
	const side = [0, 0.02, 0.5, 0.58]
	s.push({ id: 's02a', img: 'A2-extensions', start: 5, dur: 2.6, keys: [key(0, whole(0.86), { focus: [0.15, 0.4] }), key(1.4, side, { focus: [0.08, 0.3], zoom: 2 }), key(2.6, side, { focus: [0.08, 0.32], zoom: 2 })],
		label: { text: 'Extensions from Open VSX', x: 330, y: 150, at: 5.9, dur: 3.3 } })
	s.push({ id: 's02b', img: 'A3-themes', start: 7.6, dur: 1.8, keys: [key(0, side, { focus: [0.08, 0.32], zoom: 2 }), key(1.8, [0, 0.03, 0.48, 0.57], { focus: [0.08, 0.34], zoom: 2 })] })
	s.push({ id: 's02c', img: 'A4-keys', start: 9.4, dur: 1.6, keys: [key(0, [0.15, 0.02, 0.85, 0.62], { focus: [0.45, 0.2] }), key(1.6, [0.16, 0.03, 0.82, 0.6], { focus: [0.45, 0.22] })] })
	// 03 Open an endpoint: Insilode's Endpoints view in the side bar, POST /orders (OrderController.place) under the pointer,
	// then the click opens the flow tab beside the code tab.
	s.push({ id: 's03a', img: 'B1-sidebar', start: 11, dur: 1.6, keys: [key(0, [0, 0.03, 0.5, 0.5], { focus: [0.08, 0.2], zoom: 2 }), key(1.6, [0, 0.06, 0.4, 0.44], { focus: [0.08, 0.24], zoom: 2.2 })] })
	// The click: the same framing on the still taken after it, then the camera follows the flow tab that opened.
	s.push({ id: 's03b', img: 'B2-sidebar', start: 12.6, dur: 4.4, keys: [key(0, [0, 0.06, 0.4, 0.44], { focus: [0.08, 0.24], zoom: 2.2 }), key(0.6, [0, 0.06, 0.4, 0.44], { focus: [0.08, 0.24], zoom: 2.2 }), key(4.4, [0.17, 0.06, 0.8, 0.78], { focus: [0.33, 0.38], zoom: 1.5 })] })
	// 04 Across services: the hops into billing (HTTP) and shipping (Kafka) expanded; rings on the labels as the voice names them.
	const s4 = 17
	const http = at('04', 'HTTP') - s4, kafka = at('04', 'Kafka') - s4
	s.push({ id: 's04', img: 'B3-sidebar', start: s4, dur: 5, keys: [
		key(0, [0.17, 0.28, 0.8, 0.78], { focus: [0.45, 0.45], zoom: 1.5 }),
		key(Math.max(0.6, http - 0.5), [0.42, 0.44, 0.8, 0.66], { focus: [0.66, 0.57], zoom: 1.6 }),
		key(Math.max(1.6, kafka - 0.3), [0.42, 0.55, 0.8, 0.77], { focus: [0.61, 0.68], zoom: 1.6 }),
		key(5, [0.43, 0.55, 0.79, 0.76], { focus: [0.62, 0.68], zoom: 1.6 }),
	], rings: [
		{ t: http, dur: 1.4, rect: [0.651, 0.563, 0.664, 0.581] },
		{ t: kafka, dur: 1.6, rect: [0.599, 0.674, 0.613, 0.692] },
	] })
	// 05 An agent changes the code: the commit in the terminal, "Show Changes in Flow", the change set, then POST /orders.
	s.push({ id: 's05a', img: 'C1-commit', start: 22, dur: 3.4, keys: [key(0, [0.15, 0.36, 0.8, 0.9], { focus: [0.3, 0.8], zoom: 1.6 }), key(3.4, [0.16, 0.5, 0.62, 0.88], { focus: [0.3, 0.8], zoom: 1.6 })] })
	s.push({ id: 's05b', img: 'C2-pick', start: 25.4, dur: 1, keys: [key(0, [0.3, 0, 0.7, 0.36], { focus: [0.48, 0.1] }), key(1, [0.31, 0, 0.69, 0.34], { focus: [0.48, 0.1] })] })
	s.push({ id: 's05c', img: 'C3-changes', start: 26.4, dur: 3.2, keys: [key(0, [0.16, 0.02, 0.84, 0.5], { focus: [0.28, 0.12], zoom: 1.4 }), key(3.2, [0.16, 0.03, 0.68, 0.38], { focus: [0.28, 0.14], zoom: 1.4 })] })
	s.push({ id: 's05d', img: 'C4-place', start: 29.6, dur: 4.4, keys: [key(0, [0.2, 0.12, 0.84, 0.6], { focus: [0.55, 0.36], zoom: 1.4 }), key(4.4, [0.42, 0.22, 0.8, 0.5], { focus: [0.56, 0.35], zoom: 1.4 })] })
	// 06 Agents side by side: the dock in the right side bar comes alive (the dock page's take, laid over it); push in.
	s.push({ id: 's06', img: 'D-base', start: 34, dur: 8, dock: { mediaStart: 3.0 }, keys: [key(0, whole(0.86), { focus: [0.88, 0.3] }), key(1.4, whole(0.86), { focus: [0.88, 0.3] }), key(4.4, [0.55, 0.02, 1.0, 0.62], { focus: [0.9, 0.3], zoom: 1.5 }), key(8, [0.6, 0.03, 1.0, 0.6], { focus: [0.9, 0.3], zoom: 1.5 })] })
	// 07 The harness map in the side bar, next to CLAUDE.md.
	s.push({ id: 's07', img: 'E-harness', start: 42, dur: 6, keys: [key(0, whole(0.86), { focus: [0.1, 0.35] }), key(1.0, [0, 0.03, 0.55, 0.5], { focus: [0.09, 0.3], zoom: 1.8 }), key(6, [0, 0.04, 0.5, 0.46], { focus: [0.09, 0.3], zoom: 1.8 })] })
	// 08 The headline: the window again, quiet, pulling back. 09 End card: the window dims behind the lockup and drifts.
	s.push({ id: 's08', img: 'B3-sidebar', start: 48, dur: 6, keys: [key(0, whole(0.78), { focus: [0.5, 0.45] }), key(6, whole(0.73), { focus: [0.5, 0.45] })] })
	s.push({ id: 's09', img: 'A1-editor', start: 54, dur: 8, dim: 0, dimTo: [0.82, 54.2, 1.2], keys: [key(0, whole(0.76), { focus: [0.4, 0.4] }), key(8, whole(0.7), { focus: [0.4, 0.4] })] })
	return s
}

function shotsLoop() {
	return [
		{ id: 'l1', img: 'A1-editor', start: 0, dur: 3, keys: [key(0, whole(0.84)), key(3, whole(0.88))] },
		{ id: 'l2', img: 'B3-sidebar', start: 3, dur: 4, keys: [key(0, whole(0.88)), key(4, [0.2, 0.3, 0.8, 0.78])] },
		{ id: 'l3', img: 'C4-place', start: 7, dur: 4, keys: [key(0, [0.2, 0.12, 0.84, 0.6]), key(4, [0.4, 0.2, 0.82, 0.52])] },
		{ id: 'l4', img: 'D-base', start: 11, dur: 2.5, dock: { mediaStart: 6.5 }, keys: [key(0, [0.5, 0.02, 1.0, 0.64]), key(2.5, [0.55, 0.02, 1.0, 0.62])] },
		{ id: 'l5', img: 'A1-editor', start: 13.5, dur: 1.5, keys: [key(0, whole(0.86)), key(1.5, whole(0.84))] },
	]
}

// The narrow cuts frame `focus` with a rect `zoom` times tighter (in width) than the wide rect, at the frame's aspect.
function rectFor(k, f, variant) {
	if (variant === 'film' || variant === 'loop') return k.rect
	const [x0, y0, x1, y1] = k.rect
	const area = { w: f.w, h: f.h * 0.84 }
	const [cx, cy] = k.focus ?? [(x0 + x1) / 2, (y0 + y1) / 2]
	// Width in window fractions: the wide rect's width over the zoom, but never wider than the window plus margin.
	// A shot inside the window keeps the window filling the narrow frame top to bottom (no stage below it).
	const inside = x0 >= 0 && y0 >= 0 && x1 <= 1 && y1 <= 1
	const tall = (IW / IH) * (area.h / area.w)
	const w = inside ? Math.min((x1 - x0) / (k.zoom ?? 1.3), 1 / tall) : 1.1
	const h = w * tall
	const nx = Math.min(Math.max(cx - w / 2, -0.04), 1.04 - w), ny = Math.min(Math.max(cy - h / 2, -0.04), Math.max(-0.04, 1.04 - h))
	return [nx, ny, nx + w, ny + h]
}

// The camera transform that fits `rect` of the window into the picture area of the frame (top 84%, the captions below).
function fit(rect, f) {
	const bottom = f.silent ? f.h : f.h * 0.84
	const [x0, y0, x1, y1] = rect
	const rw = (x1 - x0) * IW, rh = (y1 - y0) * IH
	const s = Math.min(f.w / rw, bottom / rh)
	const cx = ((x0 + x1) / 2) * IW, cy = ((y0 + y1) / 2) * IH
	// Inside the window the image always covers the frame; a rect past the window's edge shows the stage around it.
	const inside = x0 >= 0 && y0 >= 0 && x1 <= 1 && y1 <= 1
	const clamp = (v, lo, hi) => (lo > hi ? (lo + hi) / 2 : Math.min(hi, Math.max(lo, v)))
	let x = f.w / 2 - s * cx, y = bottom / 2 - s * cy
	if (inside) { x = clamp(x, f.w - s * IW, 0); y = clamp(y, f.h - s * IH, 0) }
	return { scale: +s.toFixed(5), x: +x.toFixed(2), y: +y.toFixed(2) }
}

function captions() {
	// Lines 08 and 09 are the headline and the end card, set as type, not as captions.
	return Object.keys(VO).filter(id => !['08', '09'].includes(id)).map(id => ({ id: `c${id}`, start: VO[id], dur: +(voEnd(id) - VO[id] + 0.4).toFixed(2), text: line(id) }))
}

function build(variant) {
	const f = FORMATS[variant]
	const out = join(shots, 'build', variant)
	mkdirSync(join(out, 'assets', 'fonts'), { recursive: true })
	const used = new Set()
	const asset = name => { used.add(name); return `assets/${name}.jpg` }
	const tl = []
	let html = ''
	let dockUsed = false
	for (const s of variant === 'loop' ? shotsLoop() : shotList()) {
		const k0 = fit(rectFor(s.keys[0], f, variant), f)
		const rings = (s.rings ?? []).map((r, i) => `<div class="ring" id="${s.id}-r${i}" style="left:${r.rect[0] * IW}px;top:${r.rect[1] * IH}px;width:${(r.rect[2] - r.rect[0]) * IW}px;height:${(r.rect[3] - r.rect[1]) * IH}px"></div>`).join('')
		// The narrow cuts frame only the side bar, so the label sits over its header there.
		const lp = s.label && (variant === "square" || variant === "vertical") ? { x: 150, y: 96 } : s.label
		const label = s.label ? `<div class="label" id="${s.id}-label" style="left:${lp.x * 2}px;top:${lp.y * 2}px">${s.label.text}</div>` : ""
		let dock = ''
		if (s.dock) {
			dockUsed = true
			const [px, py, pw, ph] = DOCK.pane
			dock = `<div class="pane" style="left:${px}px;top:${py}px;width:${pw}px;height:${ph}px;background:${DOCK.bg}"></div><video id="${s.id}-dock" class="clip" src="assets/dock-live.mp4" muted playsinline data-start="${s.start}" data-duration="${s.dur}" data-media-start="${s.dock.mediaStart}" data-track-index="2" style="position:absolute;left:${DOCK.x}px;top:${DOCK.y}px;width:${DOCK.w}px;height:${DOCK.h}px"></video>`
		}
		html += `<div id="${s.id}" class="clip" data-start="${s.start}" data-duration="${s.dur}" data-track-index="1"><div class="cam" id="${s.id}-cam" style="width:${IW}px;height:${IH}px"><img src="${asset(s.img)}" alt="">${dock}${rings}${label}</div>${s.dim !== undefined ? `<div class="dim" id="${s.id}-dim" style="opacity:${s.dim}"></div>` : ''}</div>\n`
		tl.push(`tl.set('#${s.id}-cam', ${JSON.stringify(k0)}, ${s.start})`)
		for (let i = 1; i < s.keys.length; i++) {
			const d = s.keys[i].t - s.keys[i - 1].t
			if (d <= 0) continue
			tl.push(`tl.to('#${s.id}-cam', { ...${JSON.stringify(fit(rectFor(s.keys[i], f, variant), f))}, duration: ${d.toFixed(3)}, ease: 'power2.inOut' }, ${(s.start + s.keys[i - 1].t).toFixed(3)})`)
		}
		if (s.dimTo) tl.push(`tl.to('#${s.id}-dim', { opacity: ${s.dimTo[0]}, duration: ${s.dimTo[2]}, ease: 'power2.inOut' }, ${s.dimTo[1]})`)
		for (const [i, r] of (s.rings ?? []).entries()) {
			tl.push(`tl.fromTo('#${s.id}-r${i}', { opacity: 0 }, { opacity: 1, duration: 0.25, ease: 'power2.out' }, ${(s.start + r.t).toFixed(3)})`)
			tl.push(`tl.to('#${s.id}-r${i}', { opacity: 0, duration: 0.3, ease: 'power2.in' }, ${(s.start + r.t + r.dur).toFixed(3)})`)
		}
		if (s.label) {
			tl.push(`tl.fromTo('#${s.id}-label', { opacity: 0, y: 12 }, { opacity: 1, y: 0, duration: 0.4, ease: 'power3.out' }, ${s.label.at})`)
		}
	}
	if (variant !== 'loop') {
		html += headline(f, tl)
		html += lockup(f, tl)
		html += `<div id="captions" class="clip" data-start="0" data-duration="${f.duration}" data-track-index="8" data-track-kind="captions">${captions().map(c => `<div class="cap clip" id="${c.id}" data-start="${c.start}" data-duration="${c.dur}" data-track-index="9"><span>${c.text}</span></div>`).join('')}</div>\n`
		html += `<audio id="mix" src="assets/mix.wav" data-start="0" data-duration="${f.duration}" data-track-index="10"></audio>\n`
	} else {
		const L = [['A code editor, built on VS Code.', 0.3, 2.6], ['That shows how your code runs.', 3.3, 3.5], ["And where your agent's change lands.", 7.3, 3.5], [brand.productName, 13.6, 1.3]]
		L.forEach(([words, start, dur], i) => {
			html += `<div id="lt${i}" class="clip" data-start="${start}" data-duration="${dur}" data-track-index="3"><div class="loopt" id="lt${i}-in">${i === 3 ? `<span data-var-text="productName">${words}</span>` : words}</div></div>\n`
			tl.push(`tl.fromTo('#lt${i}-in', { opacity: 0, y: 16 }, { opacity: 1, y: 0, duration: 0.4, ease: 'power3.out' }, ${start})`)
			if (i < 3) tl.push(`tl.to('#lt${i}-in', { opacity: 0, duration: 0.3, ease: 'power2.in' }, ${(start + dur - 0.35).toFixed(3)})`)
		})
	}
	for (const name of used) copyFileSync(join(shots, 'wb', `${name}.jpg`), join(out, 'assets', `${name}.jpg`))
	if (dockUsed) copyFileSync(join(shots, DOCK.src), join(out, 'assets', 'dock-live.mp4'))
	copyFileSync(join(film, '..', '..', 'editor', 'branding', 'icon.png'), join(out, 'assets', 'icon.png'))
	for (const font of ['instrument-sans-latin-500-normal', 'instrument-sans-latin-600-normal', 'instrument-sans-latin-700-normal', 'jetbrains-mono-latin-400-normal']) copyFileSync(join(film, 'assets', 'fonts', `${font}.woff2`), join(out, 'assets', 'fonts', `${font}.woff2`))
	if (!f.silent && existsSync(join(shots, 'audio', 'mix.wav'))) copyFileSync(join(shots, 'audio', 'mix.wav'), join(out, 'assets', 'mix.wav'))
	writeFileSync(join(out, 'index.html'), page(f, html, tl))
	writeFileSync(join(out, 'hyperframes.json'), JSON.stringify({ paths: { assets: 'assets' }, media: { autoProxy: true } }, null, 2))
	console.log('wrote', out)
}

function headline(f, tl) {
	const v = f.h > f.w, sq = f.w === f.h
	const size = v ? 64 : sq ? 54 : 56
	tl.push(`tl.fromTo('#hl-in', { opacity: 0, y: 18 }, { opacity: 1, y: 0, duration: 0.6, ease: 'power3.out' }, 48.6)`)
	tl.push(`tl.to('#hl-in', { opacity: 0, duration: 0.4, ease: 'power2.in' }, 53.7)`)
	return `<div id="hl" class="clip" data-start="48.4" data-duration="5.7" data-track-index="3"><div class="stmt" id="hl-in" style="bottom:${Math.round(f.h * (v ? 0.06 : 0.04))}px;font-size:${size}px;padding:0 ${v ? 70 : 40}px">${slogan}</div></div>\n`
}

function lockup(f, tl) {
	const v = f.h > f.w, sq = f.w === f.h
	const logo = v ? 220 : sq ? 170 : 150
	const top = v ? 560 : sq ? 220 : 190
	const name = v ? 132 : sq ? 108 : 100
	tl.push(`tl.fromTo('#lk-logo', { opacity: 0, scale: 0.94 }, { opacity: 1, scale: 1, duration: 0.6, ease: 'power3.out' }, 54.2)`)
	tl.push(`tl.fromTo('#lk-name', { opacity: 0, y: 16 }, { opacity: 1, y: 0, duration: 0.5, ease: 'power3.out' }, 54.45)`)
	tl.push(`tl.fromTo('#lk-tag', { opacity: 0 }, { opacity: 1, duration: 0.5, ease: 'power2.out' }, 54.9)`)
	tl.push(`tl.fromTo('#lk-cta', { opacity: 0, y: 12 }, { opacity: 1, y: 0, duration: 0.5, ease: 'power3.out' }, 55.6)`)
	tl.push(`tl.fromTo('#lk-free', { opacity: 0 }, { opacity: 1, duration: 0.5, ease: 'power2.out' }, ${VO['09']})`)
	return `<div id="lockup" class="clip" data-start="54" data-duration="8" data-track-index="4"><div class="lk" style="top:${top}px;padding:0 60px">
<img id="lk-logo" src="assets/icon.png" style="width:${logo}px;height:${logo}px" alt="">
<div id="lk-name" class="name" style="font-size:${name}px" data-var-text="productName">${brand.productName}</div>
<div id="lk-tag" class="tag">${slogan}</div>
<div id="lk-cta"><div class="dl-line" data-var-text="download">${brand.download}</div><div class="url" data-var-text="urls">${brand.siteUrl} · ${brand.repoUrl}</div></div>
<div id="lk-free" class="free" data-var-text="freeLine">${brand.freeLine}</div>
</div></div>\n`
}

function page(f, body, tl) {
	const vars = [
		{ id: 'productName', type: 'string', label: 'Product name', default: brand.productName },
				{ id: 'download', type: 'string', label: 'Download line', default: brand.download },
		{ id: 'urls', type: 'string', label: 'Site and repository', default: `${brand.siteUrl} · ${brand.repoUrl}` },
		{ id: 'freeLine', type: 'string', label: 'Licence line', default: brand.freeLine },
	]
	const v = f.h > f.w
	const capSize = v ? 46 : f.w === f.h ? 40 : 42
	return `<!doctype html>
<html lang="en" data-composition-variables='${JSON.stringify(vars).replace(/'/g, '&#39;')}'>
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=${f.w}, height=${f.h}">
<script src="https://cdn.jsdelivr.net/npm/gsap@3.14.2/dist/gsap.min.js"></script>
<style>
@font-face { font-family: "Instrument Sans"; font-weight: 500; src: url(assets/fonts/instrument-sans-latin-500-normal.woff2) format("woff2"); }
@font-face { font-family: "Instrument Sans"; font-weight: 600; src: url(assets/fonts/instrument-sans-latin-600-normal.woff2) format("woff2"); }
@font-face { font-family: "Instrument Sans"; font-weight: 700; src: url(assets/fonts/instrument-sans-latin-700-normal.woff2) format("woff2"); }
@font-face { font-family: "JetBrains Mono"; font-weight: 400; src: url(assets/fonts/jetbrains-mono-latin-400-normal.woff2) format("woff2"); }
/* The site's dark stage (site/src/site.css): --film, --ink, --ink-2, --link, the window edge and radius. Type: the site's
   Instrument Sans and JetBrains Mono. */
:root { --film: #0c1020; --ink: #e9ecf5; --ink-2: #a9b1c9; --link: #9aa8ff; --signal: #3f52c9; --edge: rgba(255, 255, 255, .09); }
* { margin: 0; padding: 0; box-sizing: border-box; }
html, body { width: ${f.w}px; height: ${f.h}px; overflow: hidden; background: var(--film); }
#root { position: relative; width: 100%; height: 100%; overflow: hidden; background: var(--film); font-family: "Instrument Sans", sans-serif; color: var(--ink); }
#root > .clip { position: absolute; inset: 0; overflow: hidden; }
.cam { position: absolute; left: 0; top: 0; transform-origin: 0 0; border-radius: 20px; overflow: hidden; box-shadow: 0 0 0 2px var(--edge), 0 60px 160px rgba(0, 0, 0, .65); }
.cam img { display: block; width: 100%; height: 100%; }
.pane { position: absolute; }
.dim { position: absolute; inset: 0; background: var(--film); }
.ring { position: absolute; border: 6px solid var(--link); border-radius: 12px; opacity: 0; box-shadow: 0 0 0 4px rgba(12, 16, 32, .6); }
.label { position: absolute; opacity: 0; font-size: 46px; font-weight: 600; padding: 10px 28px; border-radius: 40px; background: var(--signal); color: #fff; white-space: nowrap; }
.stmt { position: absolute; left: 0; right: 0; text-align: center; font-weight: 700; letter-spacing: -0.025em; line-height: 1.06; color: var(--ink); }
.loopt { position: absolute; left: 0; right: 0; bottom: 44px; text-align: center; font-size: 60px; font-weight: 700; letter-spacing: -0.02em; text-shadow: 0 4px 30px rgba(0, 0, 0, .85); }
.lk { position: absolute; left: 0; right: 0; display: flex; flex-direction: column; align-items: center; gap: 16px; text-align: center; }
.nm { color: var(--link); }
.lk .name { font-weight: 700; letter-spacing: -0.03em; line-height: 1; }
.lk .tag { font-size: ${v ? 44 : 36}px; font-weight: 500; color: var(--ink-2); }
.lk .dl-line { margin-top: 30px; font-size: ${v ? 40 : 34}px; font-weight: 600; }
.lk .url { margin-top: 10px; font-family: "JetBrains Mono", monospace; font-size: ${v ? 32 : 30}px; color: var(--link); }
.lk .free { margin-top: 18px; font-size: ${v ? 34 : 30}px; color: var(--ink-2); }
#captions { pointer-events: none; }
.cap { position: absolute; left: 0; right: 0; top: auto; bottom: ${v ? 260 : Math.round(f.h * 0.045)}px; display: flex; justify-content: center; }
.cap span { max-width: ${Math.round(f.w * 0.86)}px; text-align: center; font-size: ${capSize}px; font-weight: 500; line-height: 1.25; padding: 8px 22px; border-radius: 12px; background: rgba(12, 16, 32, .84); color: var(--ink); }
</style>
</head>
<body>
<div id="root" data-composition-id="main" data-start="0" data-duration="${f.duration}" data-width="${f.w}" data-height="${f.h}">
${body}</div>
<script>
const tl = gsap.timeline({ paused: true });
${tl.join(';\n')};
window.__timelines["main"] = tl;
</script>
</body>
</html>
`
}

for (const v of process.argv.slice(3).length ? process.argv.slice(3) : Object.keys(FORMATS)) build(v)
