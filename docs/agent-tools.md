# Agent tools

## The `axle` MCP server

Claude Code over `/ide` only shows its model the `getDiagnostics` tool, so Axle ships its own small MCP server, `axle`, that lets an agent work with the editor. All tools are read, display or open only: they write no files and run no commands, and paths must lie inside an open workspace folder.

| Tool | What it does |
|---|---|
| `open` | Opens a file at a line or range, without taking focus |
| `find_entry_points` | Free-text search over endpoints and jobs ("delete user" finds `DELETE /users/{id}`) |
| `show_flow`, `flow_text` | Opens the flow canvas, or returns the call chain as compact text (files, call lines, tables touched) |
| `impact` | Who calls a method, and which entry points reach it |
| `get_context` | Active file, selection, flow on the canvas, open tabs, git changes, diagnostics, boards |
| `draw_board`, `update_board` | The agent draws a flow, plan, class, ER or architecture board, and ticks its steps off as it works |

- **Agents started from the Agents dock** get the server automatically (`flow.agents.mcp`, on by default; it adds `--mcp-config` and keeps your own MCP servers).
- **A `claude` you start yourself** gets it after the command **Axle: Connect Claude Code Tools (MCP)**. It shows the exact `claude mcp add` it will run and changes your Claude Code user configuration only when you confirm; **Disconnect** removes it.
- Each Axle window lists itself in `~/.axle/bridge/<pid>.json` (loopback port and token); the server picks the window whose workspace folder contains its working directory.
- In plan mode, the plan an agent submits is drawn as a board (`flow.agents.planBoard`), its steps move to doing and done as files are edited, and when a turn ends the Agents dock lists the flows it touched (`flow.agents.turnImpact`). Boards open as a Markdown preview with a Mermaid diagram; **Axle: Show Board…** lists them.

## How agent status works

Axle starts `claude` with `--settings <file>` that adds observe-only hooks on top of your own settings (your hooks still run). Each hook runs a small Node script that posts the event to the Axle window. The hooks never answer a permission question: Claude Code keeps asking you itself. Codex and custom agents are listed without status.
