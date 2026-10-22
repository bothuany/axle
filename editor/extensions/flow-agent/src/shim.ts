/*---------------------------------------------------------------------------------------------
 *  Insilode: `claude` typed by hand in an Insilode terminal. Claude Code shows a model only getDiagnostics
 *  from the /ide channel; the tools that open a diff, show a flow or search symbols come from the
 *  `insilode` MCP server, which an agent started from the Agents dock gets through --mcp-config. This
 *  shim gives a plain `claude` in any Insilode terminal the same: a script named `claude` first on PATH
 *  that finds the real one further down and adds --mcp-config. It touches nothing outside Insilode's
 *  own terminals, and the `flow.agents.shim` setting turns it off.
 *--------------------------------------------------------------------------------------------*/

/** Subcommands and flags that must reach the real claude untouched (an MCP config would break or be ignored). */
const PASS_THROUGH = 'mcp|config|update|upgrade|doctor|install|migrate-installer|setup-token|plugin|plugins|agents|auth|--version|-v|--help|-h';

const quote = (p: string) => `'${p.replace(/'/g, `'\\''`)}'`;

/** A POSIX shell script: `claude` with the `insilode` MCP config, unless this is an agent Insilode already started or a subcommand. */
export function shimScript(mcpConfig: string): string {
	return `#!/bin/sh
# Written by Insilode: starts Claude Code with Insilode's tools (open_diff, flows, boards, symbols). Rewritten on every start.
self="$(cd "$(dirname "$0")" && pwd)"
real=""
oldifs="$IFS"
IFS=:
for d in $PATH; do
	[ -n "$d" ] && [ "$d" != "$self" ] && [ -f "$d/claude" ] && [ -x "$d/claude" ] && { real="$d/claude"; break; }
done
IFS="$oldifs"
if [ -z "$real" ]; then
	echo "claude: command not found (Insilode's claude shim found no other claude on PATH)" >&2
	exit 127
fi
# An agent started from the Agents dock already carries --mcp-config; every other claude (also one run through "Other…") gets it here.
for arg in "$@"; do
	case "$arg" in
		--mcp-config|--mcp-config=*) exec "$real" "$@" ;;
	esac
done
case "$1" in
	${PASS_THROUGH}) exec "$real" "$@" ;;
esac
cfg=${quote(mcpConfig)}
[ -f "$cfg" ] && exec "$real" --mcp-config "$cfg" "$@"
exec "$real" "$@"
`;
}
