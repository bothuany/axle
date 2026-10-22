/*---------------------------------------------------------------------------------------------
 *  Insilode: the agent avatars (themes "gyro" and "pixel"), drawn by the Agents dock and by the
 *  desktop status overlay. This file is copied byte for byte into the core patch
 *  (src/vs/platform/insilodeDesktop/common/insilodeAvatars.ts in editor/patches/flow-desktop.patch);
 *  test/arch/avatars.test.mjs fails when the two differ. It imports nothing for that reason.
 *
 *  AVATAR_SCRIPT defines insilodeAvatar(kind, cli, state, context, size) in the page it is put in.
 *  Every argument is checked against a fixed list or clamped to a number, and the SVG it returns
 *  is built from constants only: no text from an agent ever reaches it.
 *--------------------------------------------------------------------------------------------*/

/** The animations the avatars use; every class starts with ax- so a page's own styles cannot collide. */
export const AVATAR_CSS = String.raw`
svg.ax{overflow:visible;display:block;flex:none}
.ax-v{transform-box:fill-box;transform-origin:center}
.ax-sp{transform-box:view-box;transform-origin:16px 16px}
@keyframes ax-tumble{0%,100%{transform:scaleY(.18)}50%{transform:scaleY(1)}}
@keyframes ax-spin{to{transform:rotate(360deg)}}
@keyframes ax-br{0%,100%{transform:scale(1)}50%{transform:scale(1.16)}}
@keyframes ax-pulse{0%{opacity:.8;transform:scale(1)}70%,100%{opacity:0;transform:scale(1.32)}}
@keyframes ax-step{0%,49%{transform:translateX(0)}50%,100%{transform:translateX(1px)}}
@keyframes ax-stepb{0%,49%{transform:translateY(0)}50%,100%{transform:translateY(-1px)}}
@keyframes ax-a{0%,49%{opacity:1}50%,100%{opacity:0}}
@keyframes ax-b{0%,49%{opacity:0}50%,100%{opacity:1}}
@keyframes ax-zf{0%,100%{opacity:.25}30%,60%{opacity:1}}
.ax-tm{animation:ax-tumble 2.8s ease-in-out infinite}
.ax-sn{animation:ax-spin 1.8s linear infinite}
.ax-cb{animation:ax-br 3s ease-in-out infinite}
.ax-pl{animation:ax-pulse 2s ease-out infinite}
.ax-pl-approval{animation-duration:1.5s}.ax-pl-question{animation-duration:2.6s}
.ax-pw{animation:ax-stepb .6s steps(1) infinite}.ax-pk{animation:ax-step .9s steps(1) infinite}.ax-pd{animation:ax-stepb .5s steps(1) infinite}
.ax-pa{animation:ax-a .8s steps(1) infinite}.ax-pb{animation:ax-b .8s steps(1) infinite}
.ax-z1{animation:ax-zf 2.4s infinite}.ax-z2{animation:ax-zf 2.4s .4s infinite}.ax-z3{animation:ax-zf 2.4s .8s infinite}
@media (prefers-reduced-motion:reduce){svg.ax *{animation:none!important}}
`;

/** Plain JavaScript for a page (no template literals in it, so it can sit inside one). */
export const AVATAR_SCRIPT = String.raw`
(function () {
	var COL = { claude: '#ff9d7d', codex: '#7fe0d6', custom: '#c6a8ff' };
	var AC = { approval: '#ffb454', question: '#c58cff', error: '#ff6b6b', done: '#5fe0a1', idle: '#5a5a62' };
	var STATES = ['working', 'approval', 'question', 'error', 'done', 'idle'];
	function n(v) { return Math.round(v * 100) / 100; }
	function stateColor(cli, s) { return s === 'working' ? COL[cli] : AC[s]; }
	function arcColor(p, c) { return p >= 85 ? AC.error : p >= 65 ? AC.approval : c; }

	function gyro(cli, s, p, z) {
		var a = stateColor(cli, s), R = 11, o = '', core;
		var still = s === 'approval' || s === 'question' || s === 'error';
		if (still) {
			o = '<circle cx="16" cy="16" r="' + R + '" fill="none" stroke="' + a + '" stroke-width="1.4"/>'
				+ '<circle class="ax-v ax-pl ax-pl-' + s + '" cx="16" cy="16" r="' + R + '" fill="none" stroke="' + a + '" stroke-width="1.2"/>';
		} else {
			[30, 150].forEach(function (ang, i) {
				if (s === 'done' && i === 1) { return; }
				var cls = '', st = '', sat = '';
				if (s === 'working') { cls = 'ax-tm'; st = 'animation-delay:-' + (i * 1.4) + 's'; }
				else if (s === 'done') { st = 'transform:scaleY(1)'; }
				else { st = 'transform:scaleY(.1)'; }
				if (s === 'working' && i === 0) { sat = '<g class="ax-sp ax-sn"><circle cx="16" cy="' + (16 - R) + '" r="1.5" fill="' + a + '"/></g>'; }
				o += '<g transform="rotate(' + ang + ' 16 16)"><g class="ax-v ' + cls + '" style="' + st + '"><circle cx="16" cy="16" r="' + R + '" fill="none" stroke="' + (s === 'idle' ? '#45454c' : a) + '" stroke-width="1.3"/>' + sat + '</g></g>';
			});
		}
		if (s === 'done') { core = '<circle cx="16" cy="16" r="5.4" fill="' + a + '"/><path d="M13.6 16.2l1.8 1.8 3.2-3.6" stroke="#06210f" stroke-width="1.5" fill="none" stroke-linecap="round" stroke-linejoin="round"/>'; }
		else if (s === 'question') { core = '<circle cx="16" cy="16" r="4.8" fill="' + a + '"/><path d="M14.5 14.7a1.5 1.5 0 1 1 2.2 1.3c-.5.3-.7.6-.7 1.1v.3" fill="none" stroke="#000" stroke-width="1.3" stroke-linecap="round"/><circle cx="16" cy="18.6" r=".75" fill="#000"/>'; }
		else if (s === 'error') { core = '<circle cx="16" cy="16" r="4.6" fill="' + a + '"/><path d="M14.4 14.4l3.2 3.2M17.6 14.4l-3.2 3.2" stroke="#000" stroke-width="1.4" stroke-linecap="round"/>'; }
		else if (s === 'approval') { core = '<circle cx="16" cy="16" r="4.8" fill="' + a + '"/><rect x="15.25" y="13.4" width="1.5" height="3.3" rx=".75" fill="#000"/><circle cx="16" cy="18.3" r=".8" fill="#000"/>'; }
		else if (s === 'idle') { core = '<circle class="ax-v ax-cb" cx="16" cy="16" r="2.6" fill="#5a5a62"/>'; }
		else { core = '<circle class="ax-v ax-cb" cx="16" cy="16" r="3.8" fill="' + a + '"/>'; }
		// The outer arc is how full the context window is; the satellite at its tip is the agent's colour.
		var Rg = 14.6, C = 2 * Math.PI * Rg, known = typeof p === 'number', q = known ? p : 0;
		var arcCol = s === 'working' ? arcColor(q, COL[cli]) : s === 'idle' ? '#55555d' : a;
		var gauge = '<circle cx="16" cy="16" r="' + Rg + '" fill="none" stroke="#1d1d23" stroke-width="1.2"/>'
			+ (known && q > 0 ? '<circle cx="16" cy="16" r="' + Rg + '" fill="none" stroke="' + arcCol + '" stroke-width="1.2" stroke-linecap="round" stroke-dasharray="' + n(C * q / 100) + ' ' + n(C) + '" transform="rotate(-90 16 16)"/>' : '');
		var ang = (-90 + 360 * q / 100) * Math.PI / 180;
		var em = '<circle cx="' + n(16 + Rg * Math.cos(ang)) + '" cy="' + n(16 + Rg * Math.sin(ang)) + '" r="1.7" fill="' + COL[cli] + '" stroke="#000" stroke-width=".9" paint-order="stroke"/>';
		return '<svg class="ax" width="' + z + '" height="' + z + '" viewBox="0 0 32 32" aria-hidden="true">' + gauge + o + core + em + '</svg>';
	}

	var SPRITES = {
		claude: ['.X.......X.', '.XX.....XX.', '.XXXXXXXXX.', 'XXXXXXXXXXX', 'XXXXXXXXXXX', 'XXXXXXXXXXX', 'XXXXXXXXXXX', '.XXXXXXXXX.', '..XXXXXXX..'],
		codex: ['..XX...XX..', '..XX...XX..', '..XX...XX..', '.XXXXXXXXX.', 'XXXXXXXXXXX', 'XXXXXXXXXXX', 'XXXXXXXXXXX', '.XXXXXXXXX.', '..XXXXXXX..'],
		custom: ['.XX.....XX.', 'XXXX...XXXX', '.XXXXXXXXX.', 'XXXXXXXXXXX', 'XXXXXXXXXXX', 'XXXXXXXXXXX', 'XXXXXXXXXXX', '.XXXXXXXXX.', '..XXXXXXX..']
	};
	function R(x, y, w, h, f) { return '<rect x="' + x + '" y="' + y + '" width="' + w + '" height="' + h + '" fill="' + f + '"/>'; }
	function P(list, f) { return list.map(function (q) { return R(q[0], q[1], 1, 1, f); }).join(''); }
	function zz(x, y, u, cls) {
		var m = ['XXXX', '..X.', '.X..', 'XXXX'], o = '';
		m.forEach(function (r, j) { for (var i = 0; i < 4; i++) { if (r[i] === 'X') { o += R(n(x + i * u), n(y + j * u), u, u, '#8b8b95'); } } });
		return '<g class="' + cls + '">' + o + '</g>';
	}
	function pixel(cli, s, z) {
		var col = COL[cli], body = '', d = '#1b1620', e = '', ey = cli === 'codex' ? 5 : 4, deco = '';
		SPRITES[cli].forEach(function (r, y) { for (var x = 0; x < 11; x++) { if (r[x] === 'X') { body += R(x, y, 1, 1, col); } } });
		var blush = R(1, ey + 2, 1, 1, '#ff8fa3') + R(9, ey + 2, 1, 1, '#ff8fa3');
		if (s === 'working') { e = '<g class="ax-pk">' + R(3, ey, 1, 2, d) + R(7, ey, 1, 2, d) + '</g>'; }
		else if (s === 'approval') { e = R(3, ey, 2, 2, d) + R(6, ey, 2, 2, d) + R(3, ey, 1, 1, '#fff') + R(6, ey, 1, 1, '#fff') + R(5, ey + 3, 1, 1, d); }
		else if (s === 'question') { e = R(3, ey, 1, 2, d) + R(7, ey - 1, 2, 3, d) + R(7, ey - 1, 1, 1, '#fff'); }
		else if (s === 'error') { e = P([[3, ey - 1], [4, ey], [3, ey + 1], [7, ey - 1], [6, ey], [7, ey + 1]], d) + R(5, ey + 3, 1, 1, d); }
		else if (s === 'done') { e = P([[2, ey + 1], [3, ey], [4, ey + 1], [6, ey + 1], [7, ey], [8, ey + 1]], d) + R(5, ey + 3, 1, 1, d); }
		else { e = R(3, ey + 1, 2, 1, d) + R(6, ey + 1, 2, 1, d); }
		if (s === 'approval') { deco = R(10, -3, 1, 2, AC.approval) + R(10, 0, 1, 1, AC.approval); }
		else if (s === 'question') { deco = R(9, -3, 2, 1, AC.question) + R(10, -2, 1, 1, AC.question) + R(9, -1, 1, 1, AC.question) + R(9, 1, 1, 1, AC.question); }
		else if (s === 'done') { deco = P([[13, -4], [12, -3], [11, -2], [9, -3], [10, -2]], AC.done); }
		else if (s === 'error') { deco = '<g class="ax-pa">' + R(1, -2, 1, 1, AC.error) + R(9, -1, 1, 1, AC.error) + '</g><g class="ax-pb">' + R(9, -2, 1, 1, AC.error) + R(1, -1, 1, 1, AC.error) + '</g>'; }
		else if (s === 'idle') { deco = zz(7.6, -2.2, 0.42, 'ax-z1') + zz(9.6, -3.8, 0.52, 'ax-z2') + zz(11.8, -5.8, 0.62, 'ax-z3'); }
		var anim = s === 'working' ? 'ax-pw' : s === 'done' ? 'ax-pd' : '';
		return '<svg class="ax" width="' + z + '" height="' + z + '" viewBox="-1 -6 15 16" shape-rendering="crispEdges" aria-hidden="true"><g transform="translate(0 1)"><g class="' + anim + '">' + body + blush + e + '</g></g>' + deco + '</svg>';
	}

	window.insilodeAvatar = function (kind, cli, state, context, size) {
		var c = Object.prototype.hasOwnProperty.call(COL, cli) ? cli : 'custom';
		var s = STATES.indexOf(state) >= 0 ? state : 'idle';
		var z = typeof size === 'number' && isFinite(size) ? Math.min(96, Math.max(12, Math.round(size))) : 24;
		var p = typeof context === 'number' && isFinite(context) ? Math.min(100, Math.max(0, context)) : undefined;
		return kind === 'pixel' ? pixel(c, s, z) : gyro(c, s, p, z);
	};
})();
`;
