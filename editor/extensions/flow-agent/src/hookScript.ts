/*---------------------------------------------------------------------------------------------
 *  Axle: the script Claude Code runs for every hook event of an agent Axle started. It posts the event to the Axle window and
 *  prints back at most one of the known reminders (skeleton first). Pure (no vscode): tested end to end in test/hookScript.test.mjs.
 *--------------------------------------------------------------------------------------------*/

import { HOOK_CONTEXT } from './skeleton';

/**
 * Reads the event from stdin and posts it to the Axle window that owns this folder now. Never blocks the agent and never decides
 * anything. The one thing it passes back is context for the agent (`hookSpecificOutput.additionalContext`, skeleton first's
 * reminders, HOOK_CONTEXT in skeleton.ts), and only those exact texts for their own events.
 */
export function hookScript(portFile: string, tokenFile: string) {
	return `// Written by Axle: forwards Claude Code hook events to the Axle window (observe only; it may hand the agent context, never a decision).
const fs = require('fs'), http = require('http');
let body = '';
process.stdin.on('data', d => body += d).on('end', () => {
	let port, token;
	try { port = fs.readFileSync(${JSON.stringify(portFile)}, 'utf8').trim(); token = fs.readFileSync(${JSON.stringify(tokenFile)}, 'utf8').trim(); } catch { process.exit(0); }
	if (!port) process.exit(0);
	const req = http.request({ host: '127.0.0.1', port, path: '/hook', method: 'POST', timeout: 3000, headers: { 'Content-Type': 'application/json', 'X-Flow-Token': token, 'X-Flow-Agent': process.env.FLOW_AGENT_SESSION || '' } }, res => {
		let out = '';
		res.setEncoding('utf8');
		res.on('data', d => { out += d; if (out.length > 8000) res.destroy(); });
		res.on('end', () => {
			// Only the one text Axle sends, exactly: whatever else answers on this port cannot put words into the agent's context.
			let o;
			// A reply past the cap is not Axle's: it is dropped whole, never parsed.
			try { if (out.length <= 8000) o = JSON.parse(out).hookSpecificOutput; } catch {}
			const known = ${JSON.stringify(HOOK_CONTEXT)};
			if (o && typeof o.hookEventName === 'string' && Object.prototype.hasOwnProperty.call(known, o.hookEventName) && o.additionalContext === known[o.hookEventName]) {
				process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: o.hookEventName, additionalContext: o.additionalContext } }), () => process.exit(0));
			} else {
				process.exit(0);
			}
		});
	});
	req.on('error', () => process.exit(0)).on('timeout', () => { req.destroy(); process.exit(0); });
	req.end(body);
});
setTimeout(() => process.exit(0), 4000);
`;
}
