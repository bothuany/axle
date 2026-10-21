// Entry of the `insilode` MCP server (bundled to out/insilode-mcp.js by esbuild.mjs). Claude Code runs it over stdio:
//   node out/insilode-mcp.js [--workspace <folder>]
// stdout carries JSON-RPC only; diagnostics go to stderr.
import { runStdio } from '../src/mcp/stdio';

if (require.main === module) {
	runStdio({ argv: process.argv.slice(2), stdin: process.stdin, stdout: process.stdout, stderr: process.stderr })
		.then(() => process.exit(0), e => {
			process.stderr.write(`[insilode-mcp] ${(e as Error)?.stack ?? e}\n`);
			process.exit(1);
		});
}
