/*---------------------------------------------------------------------------------------------
 *  Insilode: Codex's observe-only hooks. Claude Code takes them per run (--settings); Codex reads hooks
 *  only from its config layers, so Insilode writes its own profile, $CODEX_HOME/insilode.config.toml, and
 *  starts Codex with `-p insilode`: the user's config.toml is never touched, and a Codex started by hand
 *  never sees these hooks.
 *
 *  Codex runs a hook only after the user trusted it (/hooks), and records that trust against the
 *  hook's hash. So the profile must be byte-for-byte the same in every workspace and window: the
 *  command names one shared script, and the script learns which window to report to from the
 *  terminal's environment (FLOW_HOOK_DIR), not from its own text.
 *
 *  Pure (no vscode), so it is tested on its own.
 *--------------------------------------------------------------------------------------------*/

import * as os from 'os';
import * as path from 'path';

export const CODEX_PROFILE = 'insilode';

/** Where Codex keeps its config, sessions and profiles. */
export function codexHome(env: NodeJS.ProcessEnv = process.env) {
	return env.CODEX_HOME || path.join(os.homedir(), '.codex');
}

export function codexProfileFile(env: NodeJS.ProcessEnv = process.env) {
	return path.join(codexHome(env), `${CODEX_PROFILE}.config.toml`);
}

/**
 * The events Insilode listens to, and the tools each one is limited to. PreToolUse only needs the edits
 * (to keep the file as it was); Codex reports every edit as apply_patch.
 */
export const CODEX_EVENTS: [event: string, matcher?: string][] = [
	['SessionStart'],
	['UserPromptSubmit'],
	['PreToolUse', '^apply_patch$'],
	['PermissionRequest'],
	['PostToolUse'],
	['Stop'],
	['SessionEnd'],
];

/**
 * The hook's command line. Codex runs hooks through PowerShell on Windows and sh elsewhere. In the
 * desktop editor `execPath` is the Insilode executable itself, which runs a script only with
 * ELECTRON_RUN_AS_NODE set (else it opens a window); each hook is its own shell, so setting it
 * there touches nothing else.
 */
export function codexHookCommand(platform: NodeJS.Platform, execPath: string, script: string, electron: boolean): string {
	if (platform === 'win32') {
		const ps = (s: string) => `'${s.replace(/'/g, "''")}'`; // PowerShell literal string
		return `${electron ? '$env:ELECTRON_RUN_AS_NODE=1; ' : ''}& ${ps(execPath)} ${ps(script)}`;
	}
	const sh = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`;
	return `${electron ? 'ELECTRON_RUN_AS_NODE=1 ' : ''}${sh(execPath)} ${sh(script)}`;
}

/** A TOML basic string: always valid, whatever the text holds. */
export function tomlString(s: string) {
	return `"${s.replace(/[\\"]/g, c => `\\${c}`).replace(/[\u0000-\u001f\u007f]/g, c => `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`)}"`;
}

/** The profile Insilode writes. Deterministic: the same command gives the same bytes, so trust given once holds. */
export function codexProfile(command: string, timeout = 5): string {
	const lines = [
		'# Written by Insilode. Used only when Insilode starts Codex (codex -p insilode): read-only hooks that tell',
		'# Insilode\'s Agents dock what the agent is doing. They print nothing, so they never decide anything.',
		'# Your own config.toml stays as it is. Delete this file to stop it; Insilode writes it again when',
		'# it starts Codex.',
	];
	for (const [event, matcher] of CODEX_EVENTS) {
		lines.push('', `[[hooks.${event}]]`);
		if (matcher) {
			lines.push(`matcher = ${tomlString(matcher)}`);
		}
		lines.push(`[[hooks.${event}.hooks]]`, 'type = "command"', `command = ${tomlString(command)}`, `timeout = ${timeout}`);
	}
	return lines.join('\n') + '\n';
}

/**
 * The shared hook script: posts the event to the Insilode window named by the terminal's FLOW_HOOK_DIR,
 * and prints nothing (Codex then takes no decision from it; Stop treats empty output as success).
 */
export const CODEX_HOOK_SCRIPT = `// Written by Insilode: forwards Codex hook events to the Insilode window that started the agent (observe only).
const fs = require('fs'), http = require('http'), path = require('path');
const dir = process.env.FLOW_HOOK_DIR;
if (!dir) process.exit(0);
let body = '';
process.stdin.on('data', d => body += d).on('end', () => {
	let port, token;
	try { port = fs.readFileSync(path.join(dir, 'hook-port'), 'utf8').trim(); token = fs.readFileSync(path.join(dir, 'hook-token'), 'utf8').trim(); } catch { process.exit(0); }
	if (!port) process.exit(0);
	const req = http.request({ host: '127.0.0.1', port, path: '/hook', method: 'POST', timeout: 3000, headers: { 'Content-Type': 'application/json', 'X-Flow-Token': token, 'X-Flow-Agent': process.env.FLOW_AGENT_SESSION || '' } }, res => { res.resume(); res.on('end', () => process.exit(0)); });
	req.on('error', () => process.exit(0)).on('timeout', () => { req.destroy(); process.exit(0); });
	req.end(body);
});
setTimeout(() => process.exit(0), 4000);
`;
