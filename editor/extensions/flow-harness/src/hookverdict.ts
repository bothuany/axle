/*---------------------------------------------------------------------------------------------
 *  Insilode Harness: what Claude Code makes of a hook's exit code and output
 *  (https://code.claude.com/docs/en/hooks). Exit 2 blocks, with stderr as the reason, and no JSON
 *  can override that. Exit 0 lets the action go ahead unless the JSON on stdout decides otherwise.
 *  Any other exit (or a hook that was killed) is a non-blocking error: the action goes ahead and
 *  stdout is not read as a decision. Pure (no vscode), so it is tested on its own.
 *--------------------------------------------------------------------------------------------*/

/** What the hook decided: from exit code 2, or from its JSON output on exit 0. */
export type HookVerdict = 'allowed' | 'blocked' | 'asked' | 'ok' | 'failed';

export function hookVerdict(exit: number | null, stdout: string): HookVerdict {
	if (exit === 2) {
		return 'blocked';
	}
	if (exit !== 0) {
		return 'failed';
	}
	let json: { decision?: unknown; hookSpecificOutput?: { permissionDecision?: unknown } };
	try {
		json = JSON.parse(stdout) as typeof json;
	} catch {
		return 'ok'; // plain text output
	}
	if (!json || typeof json !== 'object') {
		return 'ok';
	}
	const d = json.hookSpecificOutput?.permissionDecision ?? json.decision;
	return d === 'deny' || d === 'block' ? 'blocked' : d === 'ask' ? 'asked' : d === 'allow' || d === 'approve' ? 'allowed' : 'ok';
}
