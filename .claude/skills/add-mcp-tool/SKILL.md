---
name: add-mcp-tool
description: Add or change a tool of Axle's own `axle` MCP server (editor/extensions/flow-view/mcp and src/mcp) and keep its definition, handler, tests, user-facing lists and docs in step. Use when asked to add, rename or extend an mcp__axle__ tool.
argument-hint: "<tool name and what it should do>"
---

An `axle` tool lives in several places that drift apart if one is missed. Change all of them in one go.

**Rules that hold for every tool**
- Read, display or open only: a tool writes no files and runs no commands. Any path argument is resolved against, and must stay inside, an open workspace folder.
- `mcp/axle-mcp.ts`, `src/mcp/stdio.ts` and everything they import run in plain Node with no `vscode`, even transitively. Only the host-facing files listed in `.dependency-cruiser.cjs` (such as `src/mcp/handlers.ts`) touch `vscode`.
- The stdio server forwards calls to the Axle window over the loopback bridge (`src/mcp/bridge.ts`, `http.ts`); the work itself happens in the window.

**Where to change**
1. `src/mcp/tools.ts`: the `TOOLS` entry. Its `description` tells the model when to use the tool and when to use a different one; its `inputSchema` has `additionalProperties: false`; `annotations` use `ro(...)` for read-only.
2. `src/mcp/handlers.ts`: the `case '<name>'` in the dispatch and its handler method; validate arguments and paths there.
3. `src/mcp/protocol.ts`: the server `instructions`, if the tool changes how an agent should pick between tools.
4. `src/mcp/register.ts`: the list of tool names shown before `claude mcp add`.
5. `test/mcp-protocol.test.mjs`: the expected tool-name list, plus a call test; `test/mcp-registry.test.mjs` or `mcp-search.test.mjs` when the tool reads the registry or search.
6. `docs/agent-tools.md`: the tool table.

**Check**
- `cd editor/extensions/flow-view && npm test`
- `npm run arch` from the repo root (catches a `vscode` import reaching the stdio server).
- Smoke test: pipe an `initialize` and a `tools/list` request into `node out/axle-mcp.js --workspace <repo>` and confirm the tool is listed.
