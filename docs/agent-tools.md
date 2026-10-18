# Agent tools

## The `axle` MCP server

Claude Code over `/ide` only shows its model the `getDiagnostics` tool, so Axle ships its own small MCP server, `axle`, that lets an agent work with the editor. All tools are read, display or open only: they write no files and run no commands, and paths must lie inside an open workspace folder.

| Tool | What it does |
|---|---|
| `open` | Opens a file at a line or range, without taking focus |
| `open_diff` | Opens git changes (modified, staged, deleted, new) in the multi-file diff view, optionally also on the flow canvas; `base` picks what they are measured against: uncommitted (HEAD), the whole branch, or the last commit |
| `get_diagnostics` | The errors and warnings the language servers report now, for a file or the whole workspace |
| `find_symbol` | Searches classes, methods, functions and fields by name |
| `go_to_definition`, `find_references` | Where a symbol is defined (with its signature), and every place that uses it |
| `find_entry_points` | Free-text search over endpoints and jobs ("delete user" finds `DELETE /users/{id}`) |
| `show_flow`, `flow_text` | Opens the flow canvas, or returns the call chain as compact text (files, call lines, tables touched; `~table` after a database line means the table name is a guess) |
| `impact` | Who calls a method, and which entry points reach it (through interfaces, mediators and, as a guess, HTTP calls and messages between services). With `table` or `entity` instead of a method: the endpoints that write that table and the endpoints that read it, each with the method and database card it goes through, a guess marked `~table?`, and a "not checked" line (see [Tables and entities](languages.md#tables-and-entities)). A migration file or an entity file alone (`file` without `method` or `line`) answers the same for the tables it changes, with what a migration adds and drops and the code that may still use a dropped column |
| `get_context` | Active file, selection, flow on the canvas, open tabs, git changes, diagnostics, boards |
| `draw_board`, `update_board` | The agent draws a flow, plan, class, ER or architecture board, and ticks its steps off as it works |

- **Agents started from the Agents dock** get the server automatically (`flow.agents.mcp`, on by default; it adds `--mcp-config` and keeps your own MCP servers).
- **A `claude` you start yourself** gets it after the command **Axle: Connect Claude Code Tools (MCP)**. It shows the exact `claude mcp add` it will run and changes your Claude Code user configuration only when you confirm; **Disconnect** removes it.
- Each Axle window lists itself in `~/.axle/bridge/<pid>.json` (loopback port and token); the server picks the window whose workspace folder contains its working directory.
- In plan mode, the plan an agent submits is drawn as a board (`flow.agents.planBoard`), its steps move to doing and done as files are edited, and when a turn ends the Agents dock lists the flows it touched (`flow.agents.turnImpact`), and the table, with its endpoint count, when an edit landed in an entity. That list follows the methods the turn's edits landed in, and names them on hover; an edit outside every method (an import, a field) counts its whole file. Boards open as a Markdown preview with a Mermaid diagram; **Axle: Show Board…** lists them.

**Changes in flow.** Ask an agent to "show what you did in flow" (it calls `open_diff` with `flow: true`), or run **Axle: Show Git Changes in Flow** from the command palette, the Source Control title or a diff editor. Either way one canvas shows the whole change set: every endpoint flow the changed files reach, cut down to the paths that lead to a changed method, plus the changed methods no endpoint reaches. Changed cards show added lines in green and removed lines in red. Pick what to compare with:

- **Uncommitted changes**: against HEAD. Cards offer Undo and Keep.
- **This branch**: everything since the branch left `main` or `master`, committed or not. On `main` itself, the commits not pushed yet.
- **Last commit**: the last commit plus anything uncommitted on top.

A branch or last-commit card says "Changed since main" and has no Undo, because Axle does not undo commits.

Home's prompt and **Ask about this flow** send the question to the agent you choose. The first time, a picker offers the running sessions that are waiting at their prompt (Claude Code, Codex, or a custom agent marked `acceptsInput`), a new Claude Code, Codex or custom session, the chat panel when a chat provider is installed, and the clipboard. Later questions go to the same place without asking; a note in the status bar says where each one went, and clicking it (or **Axle: Change Agent for Questions…**, or *change* under Home's prompt) picks again. If the session you chose has closed, the question goes to another waiting session of the same CLI, else a new one. Text is only typed into a session that is at its prompt, never into one that is working or waiting on a permission question: then the question goes to the clipboard. The setting `flow.agents.askTarget` makes it `ask` every time, or fixes it to `claude`, `codex`, `custom:<name>`, `chat` or `clipboard`. **Axle: Pin Flow as Board** keeps the flow on the canvas as a board, so boards do not need an agent.

## How agent status works

Axle starts `claude` with `--settings <file>` that adds observe-only hooks on top of your own settings (your hooks still run). Each hook runs a small Node script that posts the event to the Axle window. The hooks never answer a permission question: Claude Code keeps asking you itself.

Codex reads hooks only from its config layers, so Axle writes its own profile, `$CODEX_HOME/axle.config.toml`, the first time it starts Codex, and starts it with `codex -p axle`; your `config.toml` is not changed, and a `codex` you start yourself does not see these hooks. Codex runs a hook only after you trust it: run `/hooks` in Codex once and trust Axle's. Until then the dock shows a hint instead of a status. An older Codex that cannot take `-p axle` is started as before, without status. Turn it off with `flow.agents.codexHooks`.

Custom agents (any other CLI) are listed without status.
