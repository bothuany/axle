# Flow

A code editor built around how code **runs**, and around the agents that change it.

Flow is VS Code with a small set of core patches and four built-in extensions, in a native window. It adds:

- **A call-flow canvas.** Pick an endpoint, or put the cursor in any method, and see the chain it runs: controller → handler → services → database, each step as an editable card with its real code. Database cards show the table schema the query touches.
- **Terminal-first agents.** Claude Code and Codex run as their real CLIs in terminals. An Agents dock shows each one's state at a glance (working, needs you, done), its prompt, its current step, its to-dos and how full its context is. Closed sessions resume where they stopped. You can add any other agent CLI.
- **Claude Code `/ide` support.** `claude` in a Flow terminal connects automatically: its diffs open in Flow with Accept and Reject, and the methods they touch light up on the canvas.
- **Harness engineering tools.** A map and health score of your `CLAUDE.md`, skills, hooks and permissions; a hook studio that runs a hook with a realistic payload; a permission inbox that turns an answer into a standing rule; a context-budget meter.

## Languages

| | Flow from an endpoint | Flow at the cursor | Database schema cards |
|---|---|---|---|
| C# / .NET | ✓ (Roslyn, incl. MediatR and DI) | ✓ | ✓ EF Core |
| Java | ✓ Spring, JAX-RS, Servlets, Axis2, JSF | ✓ | in progress: JPA, JDBC |
| Python | in progress: FastAPI, Flask, Django | in progress | in progress: SQLAlchemy, Django ORM |
| JavaScript / TypeScript | in progress: Express, NestJS, Next.js | in progress | in progress: TypeORM, Prisma |

C# uses the Roslyn analyzer in `analyzer/`. The other languages use a tree-sitter index in `editor/extensions/flow-view/src/poly` (being wired into the canvas). For any language with a language server, "flow at the cursor" also works through its call hierarchy.

## Requirements

| | macOS | Windows | Linux |
|---|---|---|---|
| Node 22+ (24 recommended) and git | required | required | required |
| Rust ([rustup.rs](https://rustup.rs)), for the desktop window | optional | optional | optional |
| .NET 10 SDK, for C# flows | optional | optional | optional |
| Build tools for VS Code's native modules | Xcode Command Line Tools | Python 3 + Visual Studio Build Tools ("Desktop development with C++") | `build-essential`, `libx11-dev`, `libxkbfile-dev`, `libsecret-1-dev` |

Without Rust, run Flow in your browser with `npm run web`.

## Getting started

```bash
git clone https://github.com/bothuany/harness-flow.git
cd harness-flow
npm run setup
npm start
```

`npm run setup` clones VS Code 1.141.0 into `editor/vscode`, applies `editor/patches`, links the Flow extensions into it, and builds everything. The first run takes 10–20 minutes, mostly VS Code's `npm ci`. Running it again skips finished steps.

```bash
npm start -- path/to/project     # desktop window, opening a folder
npm run web -- path/to/project   # same editor at http://127.0.0.1:8765
```

## Layout

```
desktop/            Tauri shell: starts the editor server and shows it in a native window
editor/patches/     core patches to VS Code (branding, theme hooks, chat defaults, webview fixes)
editor/extensions/
  flow-view/        canvas host, endpoints list, Roslyn + polyglot providers, Claude Code /ide bridge
  flow-agent/       terminal agents and the Agents dock (plus ACP chat sessions, off by default)
  flow-harness/     harness map, hook studio, permission inbox, context budget
  flow-theme/       Flow's colour theme and defaults
ui/                 the canvas (React Flow + Monaco), built into one script the extension inlines
analyzer/           C# analyzer (.NET 10, Roslyn MSBuildWorkspace) serving flows over HTTP
scripts/            setup and start, the same on every OS
```

## Developing

- Extensions: edit under `editor/extensions`, then `npm run build:extensions` and reload the window (`Developer: Reload Window`).
- Canvas: `npm run build:canvas`, then reload the window.
- Core patches: change files in `editor/vscode`, then regenerate the patch from there:
  `git diff > ../patches/flow-core.patch`.

## How agent status works

Flow starts `claude` with `--settings <file>` that adds observe-only hooks on top of your own settings (your hooks still run). Each hook runs a small Node script that posts the event to the Flow window. The hooks never answer a permission question: Claude Code keeps asking you itself. Codex and custom agents are listed without status.

## License

MIT. Flow builds on [VS Code](https://github.com/microsoft/vscode) (MIT); the Claude and Codex marks in the Agents dock belong to their owners.
