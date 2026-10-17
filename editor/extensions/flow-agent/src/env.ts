/*---------------------------------------------------------------------------------------------
 *  Axle: what a freshly started agent must not inherit from the environment Axle itself runs in.
 *--------------------------------------------------------------------------------------------*/

/** Settings the user chose on purpose: never stripped, even when Axle runs inside a Claude Code session. */
const USER_CONFIG = /^CLAUDE_CODE_(GIT_BASH_PATH|USE_(BEDROCK|VERTEX|FOUNDRY)|SKIP_(BEDROCK|VERTEX|FOUNDRY)_AUTH|OAUTH_TOKEN|MAX_OUTPUT_TOKENS|API_KEY_HELPER_TTL_MS)$/;

/** Variables a Claude Code session sets for its own children (child-session flags, host proxy, disabled transcripts). */
const SESSION_SCOPED = /^(CLAUDECODE|CLAUDE_CODE_|CLAUDE_AGENT_SDK_|CLAUDE_PID$|CLAUDE_EFFORT$|CLAUDE_PREVIEW_)/;

/**
 * When Axle itself was started from inside a Claude Code session, its environment carries that
 * session's variables. A fresh agent must not inherit them: null removes a variable from a terminal.
 * Outside such a session nothing is stripped, so the user's own CLAUDE_CODE_* settings (Bedrock,
 * Vertex, a Git Bash path, …) reach the agent.
 */
export function inheritedAgentEnv(env: NodeJS.ProcessEnv = process.env) {
	const out: Record<string, null> = {};
	const hosted = !!env.CLAUDE_CODE_HOST_SESSION_ID || !!env.CLAUDECODE;
	if (!hosted) {
		return out;
	}
	for (const k of Object.keys(env)) {
		if ((SESSION_SCOPED.test(k) && !USER_CONFIG.test(k)) || k === 'ANTHROPIC_BASE_URL') {
			out[k] = null;
		}
	}
	return out;
}

/** The same environment as a plain object, for a process Axle spawns itself. */
export function agentProcessEnv(extra: Record<string, string> = {}): NodeJS.ProcessEnv {
	const env: NodeJS.ProcessEnv = { ...process.env };
	for (const k of Object.keys(inheritedAgentEnv())) {
		delete env[k];
	}
	return { ...env, ...extra };
}

/**
 * The folder an agent's terminal starts in. VS Code spells a Windows drive in lower case ("c:\app"); cmd.exe and Git Bash
 * hand that spelling on to the agent, while PowerShell and a terminal opened by hand say "C:\app". Claude Code files a
 * folder's state in .claude.json under its working directory exactly as given (local MCP servers, trust, approvals),
 * so the lower-case spelling made a second entry for the same folder. Checked with Claude Code 2.1.302 and
 * `claude mcp add --scope local` from each shell.
 */
export function agentCwd(folder: string | undefined, platform: NodeJS.Platform = process.platform): string | undefined {
	return folder && platform === 'win32' ? folder.replace(/^([a-z]):/, (_, d: string) => `${d.toUpperCase()}:`) : folder;
}
