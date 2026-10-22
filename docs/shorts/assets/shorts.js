// Insilode Shorts: the helpers every template shares (the camera, the text markup, the variables).
// Loaded once by the episode's index.html; a template's inline script calls window.Shorts.
(function () {
	// Every capture is the whole window at 2x: 3840 x 2160 image px.
	var IW = 3840, IH = 2160

	// The per-instance values of a sub-composition (its declared defaults, then the host's data-variable-values) live under its id.
	function vars(id) { var by = window.__hfVariablesByComp; return (by && by[id]) || window.__hyperframes.getVariables() }

	// A variable that carries JSON (an array of beats, camera keys): the data file keeps it as a real array and the
	// generator writes it as a string, because a composition variable is a scalar.
	function json(v, fallback) {
		if (v === undefined || v === null || v === '') return fallback
		if (typeof v !== 'string') return v
		try { return JSON.parse(v) } catch (e) { return fallback }
	}

	function esc(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;') }

	// "Open an *endpoint*" -> the starred words in the accent colour.
	function rich(s) { return esc(s).replace(/\*([^*]+)\*/g, '<b class="k">$1</b>') }

	// A camera key {t, cx, cy, w}: the point of the window (fractions) at the panel's centre, and the share of the
	// window's width the panel shows. The result always covers the panel (never an empty edge).
	function fit(k, pw, ph) {
		var s = pw / (k.w * IW)
		var x = pw / 2 - s * k.cx * IW, y = ph / 2 - s * k.cy * IH
		x = Math.min(0, Math.max(pw - s * IW, x))
		y = Math.min(0, Math.max(ph - s * IH, y))
		return { scale: +s.toFixed(5), x: +x.toFixed(2), y: +y.toFixed(2) }
	}

	// Camera moves inside a panel: the first key is where it starts, every later key is a slow move to it.
	function camera(tl, sel, keys, pw, ph, ease) {
		if (!keys.length) return
		tl.set(sel, fit(keys[0], pw, ph), 0)
		for (var i = 1; i < keys.length; i++) {
			var d = keys[i].t - keys[i - 1].t
			if (d <= 0) continue
			var to = fit(keys[i], pw, ph)
			to.duration = d
			to.ease = ease || 'power2.inOut'
			tl.to(sel, to, keys[i - 1].t)
		}
	}

	// Rings the real UI at a moment: {t, d, cx, cy, w, h} in window fractions; positioned in the camera's own space so
	// they ride along with the capture.
	function rings(tl, host, items) {
		items.forEach(function (r, i) {
			var el = document.createElement('div')
			el.className = 'ring'
			el.id = host.id + '-ring' + i
			el.style.left = (r.cx - r.w / 2) * IW + 'px'
			el.style.top = (r.cy - r.h / 2) * IH + 'px'
			el.style.width = r.w * IW + 'px'
			el.style.height = r.h * IH + 'px'
			host.appendChild(el)
			tl.fromTo(el, { opacity: 0 }, { opacity: 1, duration: 0.25, ease: 'power2.out' }, r.t)
			tl.to(el, { opacity: 0, duration: 0.3, ease: 'power2.in' }, r.t + r.d)
		})
	}

	// Text in clip boxes: "Two lines|of text" becomes one .ln per line inside `parent`; the returned spans rise into
	// place and leave upward through their own box, so nothing fades mid-frame.
	function lines(parent, str, id) {
		return String(str).split('|').map(function (l, i) {
			var ln = document.createElement('div')
			ln.className = 'ln'
			var s = document.createElement('span')
			s.id = id + '-' + i
			s.innerHTML = rich(l)
			s.setAttribute('data-layout-allow-overflow', '')
			ln.appendChild(s)
			parent.appendChild(ln)
			return s
		})
	}
	function rise(tl, spans, at, stagger) { tl.fromTo(spans, { yPercent: 108 }, { yPercent: 0, duration: 0.45, ease: 'power3.out', stagger: stagger || 0.09 }, at) }
	function leave(tl, spans, at, stagger) { tl.to(spans, { yPercent: -108, duration: 0.35, ease: 'power2.in', stagger: stagger || 0.05 }, at) }

	// A slow count: 3, 2, 1 over a panel. Each digit is a hard swap on its beat (a tick of the clock, no cross-fade).
	function countdown(tl, el, c) {
		if (!c) return
		var digits = []
		for (var i = c.n; i >= 1; i--) {
			var d = document.createElement('span')
			d.textContent = i
			d.style.cssText = 'position:absolute;inset:0;display:flex;align-items:center;justify-content:center;opacity:0'
			el.appendChild(d)
			digits.push(d)
		}
		digits.forEach(function (d, i) {
			tl.set(d, { opacity: 1 }, c.t + i * c.step)
			tl.set(d, { opacity: 0 }, c.t + (i + 1) * c.step)
		})
		tl.set(el, { opacity: 1 }, c.t)
		tl.set(el, { opacity: 0 }, c.t + c.n * c.step)
	}

	window.Shorts = { IW: IW, IH: IH, vars: vars, json: json, esc: esc, rich: rich, fit: fit, camera: camera, rings: rings, lines: lines, rise: rise, leave: leave, countdown: countdown }
})()
