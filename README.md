<p align="center">
  <img src="editor/branding/icon.png" width="112" alt="Axle icon">
</p>

<h1 align="center">Axle</h1>

<p align="center">
  <b>A harness-first code editor.</b><br>
  Every editor shows where code is stored. Axle shows how it <b>runs</b>.
</p>

<p align="center">
  <a href="https://github.com/bothuany/axle/releases/latest"><img src="https://img.shields.io/badge/download-Windows%20%C2%B7%20macOS%20%C2%B7%20Linux-6f86ff" alt="Download for Windows, macOS and Linux"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-6f86ff" alt="License: MIT"></a>
  <img src="https://img.shields.io/badge/agents-Claude%20Code%20%C2%B7%20Codex-6f86ff" alt="Agents: Claude Code and Codex">
</p>

<p align="center">
  <a href="docs/media/axle-demo.mp4">
    <img src="docs/media/axle-preview.webp" width="100%" alt="Axle demo: the call-flow canvas, a Claude Code diff lighting up the methods it touches, the Agents dock and the harness map">
  </a>
</p>

https://github.com/user-attachments/assets/ea31fc6d-1561-4d4f-a5cd-fa33b7163ba6

## See how your code runs

Pick an endpoint and watch the chain it runs, card by card: controller → handler → services → database, each with its real, editable code. Database cards show the table the query touches.

## Let agents work, and know when they need you

Claude Code and Codex run as their real CLIs. The Agents dock shows each one at a glance (working, needs you, done) and whatever needs you rises to the top. When Claude proposes a change, the diff opens in Axle and the methods it touches light up on the canvas.

## Keep your harness healthy

A map and health score of your `CLAUDE.md`, skills, hooks and permissions. Broken hooks and vague skills surface before they cost you a session, and one click turns a permission you keep granting into a standing rule.

## Works with your stack

C# / .NET · Java · Python · JavaScript / TypeScript · Go · PHP · Ruby · Rust, from ASP.NET and Spring to FastAPI, NestJS, Rails and axum. [Full support table →](docs/languages.md)

## Get Axle

Download from the [latest release](https://github.com/bothuany/axle/releases/latest). Everything is bundled: no Node, git or build tools needed.

| | Download | Notes |
|---|---|---|
| **Windows** | [`Axle-Setup-0.1.0-x64.exe`](https://github.com/bothuany/axle/releases/download/v0.1.0/Axle-Setup-0.1.0-x64.exe) | Installs per user, no admin rights. Not code-signed yet: on the SmartScreen warning choose *More info*, then *Run anyway*. |
| **macOS** (Apple silicon) | [`Axle-0.1.0-darwin-arm64.dmg`](https://github.com/bothuany/axle/releases/download/v0.1.0/Axle-0.1.0-darwin-arm64.dmg) | Drag to Applications. Not signed by Apple yet: allow it once under *System Settings > Privacy & Security > Open Anyway*. |
| **macOS** (Intel) | [`Axle-0.1.0-darwin-x64.dmg`](https://github.com/bothuany/axle/releases/download/v0.1.0/Axle-0.1.0-darwin-x64.dmg) | Same as above. |
| **Linux** (Debian, Ubuntu) | [`axle_0.1.0_amd64.deb`](https://github.com/bothuany/axle/releases/download/v0.1.0/axle_0.1.0_amd64.deb) | `sudo apt install ./axle_0.1.0_amd64.deb` |
| **Linux** (Fedora and other) | [`.rpm`](https://github.com/bothuany/axle/releases/download/v0.1.0/axle-0.1.0-1.x86_64.rpm) or [`.tar.gz`](https://github.com/bothuany/axle/releases/download/v0.1.0/Axle-0.1.0-linux-x64.tar.gz) | `sudo dnf install ./axle-0.1.0-1.x86_64.rpm` |

The macOS and Linux packages are new in 0.1.0 and have been built, but not yet tested on a Mac or a Linux desktop: please [report problems](https://github.com/bothuany/axle/issues). `brew`, `apt` and `winget` installs are not published yet. C# flows need the [.NET 10 SDK](https://dotnet.microsoft.com/download/dotnet/10.0).

Prefer to build it yourself? `git clone https://github.com/bothuany/axle.git && cd axle && npm run setup && npm start`.

Install details, requirements, web mode and building from source: [docs/building.md](docs/building.md). Axle's MCP tools for agents: [docs/agent-tools.md](docs/agent-tools.md).

## Contributing

Issues and pull requests are welcome: see [CONTRIBUTING.md](CONTRIBUTING.md). Report security problems privately ([SECURITY.md](SECURITY.md)).

MIT licensed. Axle builds on [VS Code](https://github.com/microsoft/vscode); the Claude and Codex marks belong to their owners.
