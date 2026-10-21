# Axle

A harness-first code editor: a VS Code fork with built-in extensions. Contributor docs: CONTRIBUTING.md, docs/building.md.

## Layout

- `editor/extensions/flow-view`: call-flow canvas host, polyglot index (`src/poly`, tree-sitter), type boards, the `axle` MCP server (`mcp/axle-mcp.ts` + `src/mcp`).
- `editor/extensions/flow-agent`: Claude Code / Codex sessions over ACP, the agent dock.
- `editor/extensions/flow-harness`: harness map, hooks studio, permissions.
- `ui/`: the canvas webview (React Flow + Monaco), built into a bundle flow-view inlines.
- `protocol/`: the types flow-view sends the canvas, declared once and imported type-only by both.
- `analyzer/`: C# Roslyn analyzer (.NET 10). `editor/vscode/` is the generated VS Code checkout: never edit it.

## Architecture rules (enforced by `npm run arch`)

- Extensions never import each other's source; they talk through registered commands. Every `flow.*` / `flowHarness.*` command one extension invokes must be registered (test/arch/commands.test.mjs).
- `ui/` and `editor/` never import each other. The canvas has no Node built-ins.
- `src/poly/worker.ts` and `mcp/axle-mcp.ts` must not reach `vscode`, even transitively. In `src/poly|board|types|mcp` only the host-facing files listed in `.dependency-cruiser.cjs` may import `vscode`.
- The wire types (`FlowNode`, `FlowEdge`, `EntryPoint`, `DbSchema`, `DbColumn`) are declared once, in `protocol/flow.ts`. flow-view and `ui/src/types.ts` re-export them with `import type` / `export type` only, `protocol/` imports nothing, and no other file may declare them again (`.dependency-cruiser.cjs`, test/arch/wire-types.test.mjs).
- Every webview page sets a Content-Security-Policy; a command id from a webview message is checked against an allowlist (.semgrep/rules).

## Commands

```bash
npm run arch                                   # dependency rules + architecture tests (seconds)
npm run semgrep                                # registry rulesets + .semgrep/rules; ERROR fails, WARNING is advisory (same in CI)
npm run semgrep:test                           # Axle's semgrep rules against their fixtures
npm run sonar:up && npm run sonar              # local SonarQube, see tools/sonarqube/README.md
cd editor/extensions/flow-view && npm test     # build + node tests; UPDATE=1 rewrites expected output
npm run test:e2e-unit                          # the desktop e2e harness: sandbox config, installer command lines, result table (no windows)
npm run docker:e2e                             # desktop e2e (or a probe script, -- --probe <file>) from source in Docker, under xvfb
npm run sandbox:e2e                            # desktop e2e inside Windows Sandbox (Windows only, needs the feature turned on), docs/building.md
cd ui && npm run typecheck && npm run build
dotnet build analyzer
```

## Conventions

- Match the file you are in: extension TypeScript uses tabs and semicolons; `ui/` uses 2 spaces and no semicolons; `scripts/*.mjs` use tabs and no semicolons. Comments explain why, in full sentences.
- Spawning processes: argument arrays, no `shell: true` (use `launch`/`launchSync` from scripts/lib.mjs in scripts).
- Never start GUI windows or steal focus from scripts or hooks.
- Where tests run: UI tests run headless in web mode (`npm run web` in the built-in browser pane, the probe skill) and never bring a window to the front. Desktop-only tests (installer, update, status island, window behaviour) go to Docker (`npm run docker:e2e`, `-- --probe <file>` for a probe), the desktop-e2e workflow or, for Windows-only checks, Windows Sandbox (`npm run sandbox:e2e`), never to the developer's desktop. `test/e2e-desktop/run.mjs` refuses to open a window unless `AXLE_E2E_ISOLATED=1`, which only CI, the sandbox script and the Docker entrypoint set (inside the machine they isolate): never set it on your own machine.
- A test that runs the C# analyzer on a copy in `os.tmpdir()` resolves it with `realpathSync.native` first: a Windows runner's temp folder has an 8.3 short name and the analyzer reports long names (checked by `npm run arch`).
