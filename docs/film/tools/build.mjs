// Writes the film's HyperFrames projects from one scene spec: the 16:9 launch film, its 1:1 and 9:16 cuts and
// the silent 15 s loop. Every picture is a capture of the app (capture/film.mjs, workbench-driver.mjs); this
// file only frames them (the camera), rings what the voice names, sets type and captions, and places the mix.
//   node build.mjs <shots dir>      reads <shots>/capture, <shots>/wb, <shots>/vo, <shots>/audio/mix.wav
// and writes <shots>/build/<variant>/ (index.html + assets), ready for `hyperframes render`.
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { VO, timing } from './timing.mjs'

const film = join(dirname(fileURLToPath(import.meta.url)), '..')
const shots = process.argv[2]
const brand = JSON.parse(readFileSync(join(film, 'brand.json'), 'utf8'))
const script = JSON.parse(readFileSync(join(film, 'vo', 'script.json'), 'utf8'))
const line = id => script.lines.find(l => l.id === id).text.replace('{spokenName}', brand.spokenName)
const { words, at, voEnd } = timing(shots)

// Image sources and their pixel sizes.
const IMG = {
	changes: ['capture/changes-tall.png', 3840, 4800],
	order: ['capture/order-after.png', 3840, 2400],
	seq: ['wb/board-seq-clean.png', 3840, 2160],
	er: ['wb/board-er.png', 3840, 2160],
	home: ['wb/home.png', 3840, 2160],
	dockWorking: ['capture/agents/dock-1-working-2.png', 1017, 1203],
	dockNeeds: ['capture/agents/dock-2-needs-you.png', 1017, 1203],
	islandWorking: ['capture/agents/island-1-working-2.png', 996, 165],
	islandNeeds: ['capture/agents/island-2-needs-you.png', 996, 165],
	tour: ['capture/tour.mp4', 1920, 1080],
	// The dock and island pages recorded live (their avatars animate), gyro first, pixel pets from 9.97 s (agents-live.mjs).
	dockLive: ['capture/dock-live.mp4', 968, 500],
	// The same take under another name: two clips of one file in a film get their seeks mixed up when rendered.
	dockLiveHook: ['capture/dock-live-hook.mp4', 968, 500],
	islandLive: ['capture/island-live.mp4', 600, 96],
	// The same take at 7x zoom on the dock's first row, so the pixel pet is drawn large, not upscaled.
	petsClose: ['capture/pets-close.mp4', 1920, 1080],
	skeleton: ['wb/skeleton.png', 3840, 2160],
	skeletonMatched: ['wb/skeleton-2.png', 3840, 2160],
	logo: ['icon.png', 1024, 1024],
}

const FORMATS = {
	film: { w: 1920, h: 1080, duration: 80 },
	square: { w: 1080, h: 1080, duration: 80 },
	vertical: { w: 1080, h: 1920, duration: 80 },
	loop: { w: 1920, h: 1080, duration: 15, silent: true },
}

// A camera key: the image region (fractions x0, y0, x1, y1) that must fill the frame's picture area.
// Per-format overrides (`square`, `vertical`) frame the same moment for a narrower frame.
const key = (t, rect, more = {}) => ({ t, rect, ...more })

function shots16(f) {
	const s = []
	// 01 Hook: the dock's real row turns amber while the statement lands.
	// The live dock: working, then its row turns amber at 1.26 s (the recording's "needs you" is at 6.457 s).
	s.push({ id: 's01', video: 'dockLiveHook', start: 0, dur: 4.2, mediaStart: 5.2, place: dockPlace(f) })
	// 03 The turn: the change set, from its root down through the changed cards.
	s.push({ id: 's03', img: 'changes', start: 12, dur: 10, fadeIn: 0.5, keys: [
		key(0, [0, 0, 0.56, 0.14], { square: [0, 0, 0.34, 0.12], vertical: [0, 0, 0.3, 0.16] }),
		key(3.4, [0, 0, 0.56, 0.14], { square: [0, 0, 0.34, 0.12], vertical: [0, 0, 0.3, 0.16] }),
		key(6.2, [0.16, 0.25, 0.64, 0.355], { square: [0.16, 0.25, 0.47, 0.355], vertical: [0.16, 0.25, 0.42, 0.37] }),
		key(10, [0.36, 0.835, 0.9, 0.935], { square: [0.36, 0.84, 0.69, 0.93], vertical: [0.36, 0.84, 0.62, 0.93] }),
	], rings: [
		{ t: 1.4, dur: 2.2, rect: [0.014, 0.028, 0.133, 0.047] },
		{ t: 3.0, dur: 1.6, rect: [0.18, 0.003, 0.252, 0.013] },
	] })
	// 04 Across services: the order flow after the change; rings on what the voice names.
	const s4 = 22
	s.push({ id: 's04', img: 'order', start: s4, dur: 8, keys: [
		key(0, [0.31, 0.17, 0.92, 0.46], { square: [0.55, 0.22, 0.91, 0.45], vertical: [0.55, 0.2, 0.84, 0.46] }),
		key(at('04', 'HTTP') - s4 - 0.9, [0.53, 0.6, 0.95, 0.82], { square: [0.6, 0.62, 0.94, 0.8], vertical: [0.62, 0.62, 0.94, 0.8] }),
		key(at('04', 'Kafka') - s4 - 0.3, [0.53, 0.76, 0.95, 0.92], { square: [0.55, 0.79, 0.82, 0.9], vertical: [0.55, 0.79, 0.82, 0.9] }),
		key(at('04', 'table') - s4 - 0.2, [0.53, 0.44, 0.8, 0.64], { square: [0.54, 0.45, 0.76, 0.63], vertical: [0.54, 0.45, 0.76, 0.63] }),
		key(8, [0.53, 0.44, 0.8, 0.64], { square: [0.54, 0.45, 0.76, 0.63], vertical: [0.54, 0.45, 0.76, 0.63] }),
	], rings: [
		{ t: at('04', 'HTTP') - s4, dur: 1.3, rect: [0.873, 0.725, 0.932, 0.743] },
		{ t: at('04', 'Kafka') - s4 + 0.3, dur: 1.2, rect: [0.743, 0.863, 0.797, 0.879] },
		{ t: at('04', 'table') - s4 + 0.1, dur: 1.4, rect: [0.556, 0.455, 0.746, 0.62] },
	] })
	// 05 The tour: the canvas's own tour, recorded (the cursor and the camera are the app's).
	s.push({ id: 's05', video: 'tour', start: 30, dur: 10, keys: [
		key(0, [0.1, 0.08, 0.9, 0.92], { square: [0.22, 0.12, 0.78, 0.9], vertical: [0.27, 0.08, 0.6, 0.92] }),
		key(10, [0.16, 0.14, 0.84, 0.86], { square: [0.25, 0.15, 0.75, 0.87], vertical: [0.29, 0.1, 0.58, 0.9] }),
	] })
	// 06 Agents: the dock beside a darkened canvas, the row turning amber on "needs you"; then the island drops.
	const flip = at('06a', 'needs')
	s.push({ id: 's06bg', img: 'changes', start: 40, dur: 14, dim: 0.72, keys: [key(0, [0, 0.24, 0.7, 0.38]), key(14, [0.02, 0.25, 0.66, 0.37])] })
	// One live take: the row turns amber on "needs" (6.457 s in the take), switches to pixel pets at 47.23 s, then works on.
	s.push({ id: 's06a', video: 'dockLive', start: 40, dur: 14, mediaStart: +(6.457 - (flip - 40)).toFixed(3), place: agentsPlace(f), pushTo: 1.1, pushAt: 4.8 })
	// Close on the avatar: the gyro, then the pixel cat with its "needs you" face (switch at 9.953 s in the take, 47.9 s here).
	s.push({ id: 's06p', video: 'petsClose', start: 47, dur: 3.2, mediaStart: 9.053, place: closePlace(f), pushTo: 1.06, pushAt: 0.8 })
	s.push({ id: 's06c', video: 'islandLive', start: 50.2, dur: 3.8, mediaStart: +(6.457 - (flip - 40) + 10.2).toFixed(3), place: islandPlace(f), drop: true })
	// 07 Diagrams: the sequence board of POST /orders, read from the index.
	s.push({ id: 's07', img: 'seq', start: 54, dur: 8, keys: [
		key(0, [0.02, 0.07, 0.98, 0.86], { square: [0.08, 0.15, 0.55, 0.65], vertical: [0.08, 0.15, 0.45, 0.85] }),
		key(3.6, [0.08, 0.14, 0.6, 0.56], { square: [0.1, 0.17, 0.5, 0.6], vertical: [0.1, 0.17, 0.42, 0.8] }),
		key(8, [0.4, 0.4, 0.96, 0.8], { square: [0.55, 0.45, 0.95, 0.8], vertical: [0.6, 0.45, 0.93, 0.85] }),
	] })
	// 08 Montage: three real views, a push-in each, cut on the downbeat.
	// Skeleton first: the agent's design with the types still MISSING, then the developer's save turns one MATCHES.
	const sk = [0.12, 0.4, 0.74, 0.7]
	const skV = { square: [0.13, 0.43, 0.55, 0.68], vertical: [0.13, 0.43, 0.42, 0.68] }
	s.push({ id: 's08a', img: 'skeleton', start: 62, dur: 2.4, keys: [key(0, sk, skV), key(2.4, [0.13, 0.41, 0.72, 0.69], skV)] })
	s.push({ id: 's08b', img: 'skeletonMatched', start: 64.4, dur: 1.6, keys: [key(0, [0.13, 0.41, 0.72, 0.69], skV), key(1.6, [0.15, 0.42, 0.7, 0.68], skV)] })
	s.push({ id: 's08c', img: 'home', start: 66, dur: 2, crop: [0.585, 0.44, 0.75, 0.535], keys: [key(0, [0.58, 0.435, 0.755, 0.54]), key(2, [0.585, 0.445, 0.72, 0.53])] })
	// 09 Held frame, 10 lockup: the change set again, quiet, then darkened behind the mark.
	s.push({ id: 's09', img: 'changes', start: 68, dur: 4, dim: 0.25, keys: [key(0, [0, 0, 0.62, 0.36], { square: [0, 0, 0.4, 0.36], vertical: [0, 0, 0.36, 0.42] })] })
	s.push({ id: 's10', img: 'changes', start: 72, dur: 8, dim: 0.25, dimTo: [0.86, 72.6, 1.4], keys: [key(0, [0, 0, 0.62, 0.36], { square: [0, 0, 0.4, 0.36], vertical: [0, 0, 0.36, 0.42] }), key(8, [0.03, 0.04, 0.6, 0.36], { square: [0.02, 0.03, 0.38, 0.35], vertical: [0.02, 0.03, 0.34, 0.41] })] })
	return s
}

function shotsLoop() {
	const A = [0, 0, 0.56, 0.14]
	return [
		{ id: 'l1', img: 'changes', start: 0, dur: 5, keys: [key(0, A), key(1, A), key(5, [0.16, 0.25, 0.64, 0.355])] },
		{ id: 'l2', video: 'tour', start: 5, dur: 5, mediaStart: 0.4, keys: [key(0, [0, 0, 1, 1]), key(5, [0.05, 0.05, 0.95, 0.95])] },
		{ id: 'l3bg', img: 'changes', start: 10, dur: 3, dim: 0.72, keys: [key(0, [0, 0.24, 0.7, 0.38])] },
		{ id: 'l3', video: 'dockLive', start: 10, dur: 3, mediaStart: 9.4, place: agentsPlace(FORMATS.loop) },
		{ id: 'l4', img: 'changes', start: 13, dur: 2, keys: [key(0, [0.1, 0.12, 0.6, 0.25]), key(2, A)] },
	]
}

// Where a fixed (not camera-driven) image sits, per format, in frame pixels: x, y, width.
function dockPlace(f) { return f.h > f.w ? { x: 140, y: 220, w: 800 } : f.w === f.h ? { x: 520, y: 90, w: 500 } : { x: 1180, y: 150, w: 600 } }
function agentsPlace(f) { return f.h > f.w ? { x: 90, y: 360, w: 900 } : f.w === f.h ? { x: 190, y: 220, w: 700 } : { x: 1000, y: 230, w: 820 } }
function closePlace(f) { return f.h > f.w ? { x: 0, y: 656, w: 1080 } : f.w === f.h ? { x: 0, y: 236, w: 1080 } : { x: 0, y: 0, w: 1920 } }
function islandPlace(f) { return f.h > f.w ? { x: 60, y: 60, w: 960 } : f.w === f.h ? { x: 90, y: 40, w: 900 } : { x: 520, y: 34, w: 880 } }

// The camera transform that fits `rect` of an image (iw x ih) into the picture area of the frame.
function fit(rect, iw, ih, f) {
	const top = 0, bottom = f.silent ? f.h : f.h * 0.84
	const [x0, y0, x1, y1] = rect
	const rw = (x1 - x0) * iw, rh = (y1 - y0) * ih
	const s = Math.min(f.w / rw, (bottom - top) / rh)
	const cx = ((x0 + x1) / 2) * iw, cy = ((y0 + y1) / 2) * ih
	// Never show past the capture's edge: clamp so the image always covers the frame.
	const clamp = (v, lo, hi) => (lo > hi ? (lo + hi) / 2 : Math.min(hi, Math.max(lo, v)))
	const x = clamp(f.w / 2 - s * cx, f.w - s * iw, 0)
	const y = clamp((top + bottom) / 2 - s * cy, f.h - s * ih, 0)
	return { scale: +s.toFixed(5), x: +x.toFixed(2), y: +y.toFixed(2) }
}

const pick = (k, variant) => (variant === 'square' && k.square) || (variant === 'vertical' && k.vertical) || k.rect

function text(variant, f) {
	const t = []
	const big = f.h > f.w ? 96 : f.w === f.h ? 84 : 110
	// 01: the statement word by word, then "Where?" alone.
	const hook = words('01a')
	t.push({ id: 't01', start: 0.4, dur: 3.9, cls: 'stmt', style: hookStyle(f, big), words: line('01a').replace('fourteen', '14').split(' ').map((w, i) => [w, VO['01a'] + hook[Math.min(i, hook.length - 1)].start]) })
	t.push({ id: 't01b', start: 4.3, dur: 1.7, cls: 'stmt', style: `${hookStyle(f, big)};color:var(--muted)`, text: 'Where?' })
	// 02: the commit's real diff stat, line by line.
	t.push({ id: 't02', start: 6, dur: 6, cls: 'diff', style: diffStyle(f), lines: readFileSync(join(shots, 'capture', 'diffstat.txt'), 'utf8').trimEnd().split('\n') })
	// 09 and 10.
	t.push({ id: 't09', start: 68.6, dur: 3.4, cls: 'stmt', style: heldStyle(f), text: 'See how your code runs.' })
	return t
}
function hookStyle(f, big) { return f.h > f.w ? `left:90px;top:1180px;width:900px;font-size:${big}px` : f.w === f.h ? `left:70px;top:560px;width:900px;font-size:${big}px` : `left:120px;top:330px;width:960px;font-size:${big}px` }
function diffStyle(f) { return f.h > f.w ? 'left:40px;top:300px;font-size:21px' : f.w === f.h ? 'left:40px;top:120px;font-size:21px' : 'left:150px;top:110px;font-size:31px' }
function heldStyle(f) { return f.h > f.w ? 'left:90px;top:1300px;width:900px;font-size:92px' : f.w === f.h ? 'left:70px;top:740px;width:940px;font-size:72px' : 'left:120px;top:700px;font-size:84px' }

function captions(f) {
	return Object.keys(VO).filter(id => !['01a', '01b', '09', '10'].includes(id)).map(id => ({ id: `c${id}`, start: VO[id], dur: +(voEnd(id) - VO[id] + 0.35).toFixed(2), text: line(id) }))
}

function build(variant) {
	const f = FORMATS[variant]
	const out = join(shots, 'build', variant)
	mkdirSync(join(out, 'assets', 'fonts'), { recursive: true })
	const used = new Set()
	const asset = name => { const [src] = IMG[name]; const file = src.split('/').pop(); used.add([src, file]); return `assets/${file}` }
	const shotList = variant === 'loop' ? shotsLoop() : shots16(f)
	const tl = []
	let html = ''
	for (const s of shotList) {
		const [, iw, ih] = IMG[s.img ?? s.video]
		if (s.video && s.place) {
			// A live page recording placed in the frame (the dock, the island): sized by place, pushed or dropped in.
			const p = s.place, h = Math.round(p.w * ih / iw)
			html += `<video id="${s.id}" class="clip media placed" src="${asset(s.video)}" muted playsinline data-start="${s.start}" data-duration="${s.dur}" data-media-start="${s.mediaStart ?? 0}" data-track-index="2" style="left:${p.x}px;top:${p.y}px;width:${p.w}px;height:${h}px"></video>
`
			if (s.drop) tl.push(`tl.fromTo('#${s.id}', { y: -${h + p.y + 20} }, { y: 0, duration: 0.55, ease: 'power3.out' }, ${s.start})`)
			if (s.pushTo) tl.push(`tl.fromTo('#${s.id}', { scale: 1 }, { scale: ${s.pushTo}, duration: ${(s.dur - s.pushAt).toFixed(2)}, ease: 'power2.inOut' }, ${s.start + s.pushAt})`)
			continue
		}
		if (s.video) {
			const k0 = fit(pick(s.keys[0], variant), iw, ih, f)
			html += `<video id="${s.id}" class="clip media" src="${asset(s.video)}" muted playsinline data-start="${s.start}" data-duration="${s.dur}"${s.mediaStart ? ` data-media-start="${s.mediaStart}"` : ''} data-track-index="1" style="width:${iw}px;height:${ih}px"></video>\n`
			tl.push(`tl.fromTo('#${s.id}', ${JSON.stringify(k0)}, { ...${JSON.stringify(fit(pick(s.keys.at(-1), variant), iw, ih, f))}, duration: ${s.dur}, ease: 'none' }, ${s.start})`)
			continue
		}
		const crop = s.crop ? `clip-path:inset(${(s.crop[1] * 100).toFixed(2)}% ${((1 - s.crop[2]) * 100).toFixed(2)}% ${((1 - s.crop[3]) * 100).toFixed(2)}% ${(s.crop[0] * 100).toFixed(2)}%);` : ''
		const rings = (s.rings ?? []).map((r, i) => `<div class="ring" id="${s.id}-r${i}" style="left:${r.rect[0] * iw}px;top:${r.rect[1] * ih}px;width:${(r.rect[2] - r.rect[0]) * iw}px;height:${(r.rect[3] - r.rect[1]) * ih}px"></div>`).join('')
		if (s.place) {
			const p = s.place, sc = p.w / iw
			html += `<div id="${s.id}" class="clip" data-start="${s.start}" data-duration="${s.dur}" data-track-index="2"><div class="cam" id="${s.id}-cam" style="left:${p.x}px;top:${p.y}px;width:${iw}px;height:${ih}px;transform-origin:0 0"><img src="${asset(s.img)}" style="width:${iw}px;height:${ih}px;${crop}" alt=""></div></div>\n`
			if (s.drop) tl.push(`tl.fromTo('#${s.id}-cam', { scale: ${sc}, y: -${ih * sc + 40} }, { scale: ${sc}, y: 0, duration: 0.55, ease: 'power3.out' }, ${s.start})`)
			else if (s.pushTo) tl.push(`tl.fromTo('#${s.id}-cam', { scale: ${sc} }, { scale: ${(sc * s.pushTo).toFixed(5)}, duration: ${(s.dur - s.pushAt).toFixed(2)}, ease: 'power2.inOut' }, ${s.start + s.pushAt})`)
			else tl.push(`tl.set('#${s.id}-cam', { scale: ${sc} }, ${s.start})`)
			continue
		}
		html += `<div id="${s.id}" class="clip" data-start="${s.start}" data-duration="${s.dur}" data-track-index="1"><div class="cam" id="${s.id}-cam" style="width:${iw}px;height:${ih}px"><img src="${asset(s.img)}" style="width:${iw}px;height:${ih}px;${crop}" alt="">${rings}</div>${s.dim ? `<div class="dim" id="${s.id}-dim" style="opacity:${s.dim}"></div>` : ''}${s.fadeIn ? `<div class="dim" id="${s.id}-fade"></div>` : ''}</div>\n`
		const ks = s.keys
		tl.push(`tl.set('#${s.id}-cam', ${JSON.stringify(fit(pick(ks[0], variant), iw, ih, f))}, ${s.start})`)
		for (let i = 1; i < ks.length; i++) {
			const d = ks[i].t - ks[i - 1].t
			tl.push(`tl.to('#${s.id}-cam', { ...${JSON.stringify(fit(pick(ks[i], variant), iw, ih, f))}, duration: ${d.toFixed(3)}, ease: 'power2.inOut' }, ${(s.start + ks[i - 1].t).toFixed(3)})`)
		}
		if (s.dimTo) tl.push(`tl.to('#${s.id}-dim', { opacity: ${s.dimTo[0]}, duration: ${s.dimTo[2]}, ease: 'power2.inOut' }, ${s.dimTo[1]})`)
		if (s.fadeIn) tl.push(`tl.fromTo('#${s.id}-fade', { opacity: 1 }, { opacity: 0, duration: ${s.fadeIn}, ease: 'power1.out' }, ${s.start})`)
		for (const [i, r] of (s.rings ?? []).entries()) {
			tl.push(`tl.fromTo('#${s.id}-r${i}', { opacity: 0 }, { opacity: 1, duration: 0.25, ease: 'power2.out' }, ${(s.start + r.t).toFixed(3)})`)
			tl.push(`tl.to('#${s.id}-r${i}', { opacity: 0, duration: 0.3, ease: 'power2.in' }, ${(s.start + r.t + r.dur).toFixed(3)})`)
		}
	}
	// The type: statements, the diff, and (film variants) the lockup and the captions.
	if (variant !== 'loop') {
		for (const t of text(variant, f)) {
			if (t.words) {
				html += `<div id="${t.id}" class="clip" data-start="${t.start}" data-duration="${t.dur}" data-track-index="3"><div class="${t.cls}" style="${t.style}">${t.words.map(([w], i) => `<span class="w" id="${t.id}-w${i}">${w}</span>`).join(' ')}</div></div>\n`
				t.words.forEach(([, time], i) => tl.push(`tl.fromTo('#${t.id}-w${i}', { opacity: 0, y: 18 }, { opacity: 1, y: 0, duration: 0.35, ease: 'power3.out' }, ${(time - 0.05).toFixed(3)})`))
				tl.push(`tl.to('#${t.id} .${t.cls}', { y: -60, opacity: 0, duration: 0.35, ease: 'power2.in' }, ${(t.start + t.dur - 0.35).toFixed(3)})`)
			} else if (t.lines) {
				html += `<div id="${t.id}" class="clip" data-start="${t.start}" data-duration="${t.dur}" data-track-index="3"><div class="${t.cls}" id="${t.id}-list" style="${t.style}">${t.lines.map((l, i) => `<div class="dl" id="${t.id}-l${i}">${diffLine(l)}</div>`).join('')}</div></div>\n`
				t.lines.forEach((_, i) => tl.push(`tl.fromTo('#${t.id}-l${i}', { opacity: 0 }, { opacity: 1, duration: 0.12, ease: 'none' }, ${(t.start + 0.15 + i * 0.22).toFixed(3)})`))
				tl.push(`tl.fromTo('#${t.id}-list', { y: 0, filter: 'blur(0px)' }, { y: -40, filter: 'blur(0px)', duration: ${t.dur - 1.6}, ease: 'none' }, ${t.start})`)
				tl.push(`tl.to('#${t.id}-list', { y: -70, filter: 'blur(10px)', opacity: 0.25, duration: 1.4, ease: 'power2.in' }, ${(t.start + t.dur - 1.6).toFixed(3)})`)
			} else {
				html += `<div id="${t.id}" class="clip" data-start="${t.start}" data-duration="${t.dur}" data-track-index="3"><div class="${t.cls}" id="${t.id}-in" style="${t.style}">${t.text}</div></div>\n`
				tl.push(`tl.fromTo('#${t.id}-in', { opacity: 0, y: 24 }, { opacity: 1, y: 0, duration: 0.5, ease: 'power3.out' }, ${t.start})`)
			}
		}
		html += lockup(f, tl)
		html += `<div id="captions" class="clip" data-start="0" data-duration="${f.duration}" data-track-index="8" data-track-kind="captions">${captions(f).map(c => `<div class="cap clip" id="${c.id}" data-start="${c.start}" data-duration="${c.dur}" data-track-index="9"><span>${c.text}</span></div>`).join('')}</div>\n`
		html += `<audio id="mix" src="assets/mix.wav" data-start="0" data-duration="${f.duration}" data-track-index="10"></audio>\n`
	} else {
		const L = [['See what your agent changed.', 0.5, 4.2], ['On how your code runs.', 5.4, 4.2], [brand.productName, 10.3, 2.4]]
		L.forEach(([words_, start, dur], i) => {
			html += `<div id="lt${i}" class="clip" data-start="${start}" data-duration="${dur}" data-track-index="3"><div class="stmt loopt" id="lt${i}-in">${i === 2 ? `<span data-var-text="productName">${words_}</span>` : words_}</div></div>\n`
			tl.push(`tl.fromTo('#lt${i}-in', { opacity: 0, y: 20 }, { opacity: 1, y: 0, duration: 0.45, ease: 'power3.out' }, ${start})`)
			tl.push(`tl.to('#lt${i}-in', { opacity: 0, duration: 0.35, ease: 'power2.in' }, ${(start + dur - 0.4).toFixed(3)})`)
		})
	}
	for (const [src, file] of used) copyFileSync(join(shots, src), join(out, 'assets', file))
	copyFileSync(join(film, '..', '..', 'editor', 'branding', 'icon.png'), join(out, 'assets', 'icon.png'))
	for (const font of ['instrument-sans-latin-500-normal', 'instrument-sans-latin-600-normal', 'instrument-sans-latin-700-normal', 'jetbrains-mono-latin-400-normal']) copyFileSync(join(film, 'assets', 'fonts', `${font}.woff2`), join(out, 'assets', 'fonts', `${font}.woff2`))
	if (!f.silent && existsSync(join(shots, 'audio', 'mix.wav'))) copyFileSync(join(shots, 'audio', 'mix.wav'), join(out, 'assets', 'mix.wav'))
	writeFileSync(join(out, 'index.html'), page(f, html, tl))
	writeFileSync(join(out, 'hyperframes.json'), JSON.stringify({ paths: { assets: 'assets' }, media: { autoProxy: true } }, null, 2))
	console.log('wrote', out)
}

function diffLine(l) {
	const esc = l.replace(/&/g, '&amp;').replace(/</g, '&lt;')
	return esc.replace(/(\++)(-*)\s*$/, (_, p, m) => `<b class="add">${p}</b><b class="del">${m}</b>`)
}

function lockup(f, tl) {
	const v = f.h > f.w, sq = f.w === f.h
	const logo = v ? 260 : sq ? 200 : 180
	const y0 = v ? 620 : sq ? 250 : 230
	const name = v ? 140 : sq ? 112 : 104
	tl.push(`tl.fromTo('#lk-logo', { opacity: 0, scale: 0.94 }, { opacity: 1, scale: 1, duration: 0.6, ease: 'power3.out' }, 74.0)`)
	tl.push(`tl.fromTo('#lk-name', { opacity: 0, y: 16 }, { opacity: 1, y: 0, duration: 0.5, ease: 'power3.out' }, 74.25)`)
	tl.push(`tl.fromTo('#lk-tag', { opacity: 0 }, { opacity: 1, duration: 0.5, ease: 'power2.out' }, 74.7)`)
	tl.push(`tl.fromTo('#lk-cta', { opacity: 0, y: 12 }, { opacity: 1, y: 0, duration: 0.5, ease: 'power3.out' }, 75.4)`)
	return `<div id="lockup" class="clip" data-start="73.6" data-duration="6.4" data-track-index="4"><div class="lk" style="top:${y0}px">
<img id="lk-logo" src="assets/icon.png" style="width:${logo}px;height:${logo}px" alt="">
<div id="lk-name" class="stmt" style="font-size:${name}px;position:static" data-var-text="productName">${brand.productName}</div>
<div id="lk-tag" class="tag" data-var-text="tagline">${brand.tagline} Free and open source.</div>
<div id="lk-cta"><div class="dl-line" data-var-text="download">${brand.download}</div><div class="url" data-var-text="repoUrl">${brand.repoUrl}</div></div>
</div></div>\n`
}

function page(f, body, tl) {
	const vars = [
		{ id: 'productName', type: 'string', label: 'Product name', default: brand.productName },
		{ id: 'tagline', type: 'string', label: 'Tagline', default: `${brand.tagline} Free and open source.` },
		{ id: 'download', type: 'string', label: 'Download line', default: brand.download },
		{ id: 'repoUrl', type: 'string', label: 'Repository URL', default: brand.repoUrl },
	]
	const capSize = f.h > f.w ? 46 : f.w === f.h ? 40 : 44
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
/* The app's own colours (sampled from Axle Dark): editor ground, text, the signal blue, change-set green and red. */
:root { --ground: #0f0f0f; --text: #f2f2f4; --muted: #8a8a90; --signal: #6f86ff; --add: #5fe0a1; --del: #ff6b7d; }
* { margin: 0; padding: 0; box-sizing: border-box; }
html, body { width: ${f.w}px; height: ${f.h}px; overflow: hidden; background: var(--ground); }
#root { position: relative; width: 100%; height: 100%; overflow: hidden; background: var(--ground); font-family: "Instrument Sans", sans-serif; color: var(--text); }
#root > .clip { position: absolute; inset: 0; overflow: hidden; }
.cam { position: absolute; left: 0; top: 0; transform-origin: 0 0; }
.cam img { display: block; }
.media { position: absolute; left: 0; top: 0; transform-origin: 0 0; }
.media.placed { transform-origin: 50% 50%; border-radius: 10px; box-shadow: 0 30px 80px rgba(0,0,0,.6); }
.dim { position: absolute; inset: 0; background: var(--ground); }
.ring { position: absolute; border: 6px solid var(--signal); border-radius: 14px; opacity: 0; box-shadow: 0 0 0 4px rgba(15,15,15,.6); }
.stmt { position: absolute; font-weight: 700; letter-spacing: -0.03em; line-height: 1.04; color: var(--text); }
.stmt .w { display: inline-block; }
.loopt { left: 0; right: 0; bottom: 80px; text-align: center; font-size: 76px; text-shadow: 0 4px 30px rgba(0,0,0,.85); }
.diff { position: absolute; font-family: "JetBrains Mono", monospace; line-height: 1.62; color: #cfcfd4; white-space: pre; }
.diff .add { color: var(--add); font-weight: 400; } .diff .del { color: var(--del); font-weight: 400; }
.lk { position: absolute; left: 0; right: 0; display: flex; flex-direction: column; align-items: center; gap: 18px; text-align: center; }
.lk .tag { font-size: ${f.h > f.w ? 40 : 34}px; font-weight: 500; color: var(--muted); }
.lk .dl-line { margin-top: 26px; font-size: ${f.h > f.w ? 38 : 32}px; font-weight: 600; }
.lk .url { margin-top: 8px; font-family: "JetBrains Mono", monospace; font-size: ${f.h > f.w ? 34 : 30}px; color: var(--signal); }
#captions { pointer-events: none; }
.cap { position: absolute; left: 0; right: 0; top: auto; bottom: ${f.h > f.w ? 300 : Math.round(f.h * 0.055)}px; display: flex; justify-content: center; }
.cap span { max-width: ${Math.round(f.w * 0.8)}px; text-align: center; font-size: ${capSize}px; font-weight: 500; line-height: 1.25; padding: 10px 22px; border-radius: 12px; background: rgba(15,15,15,.82); color: var(--text); }
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
