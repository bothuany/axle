# Building and running Axle

## Install (Windows)

Download `Axle-Setup-<version>-x64.exe` from the [Releases](https://github.com/bothuany/axle/releases) page and run it. That is all: Axle ships with everything it needs, so no Node, git or build tools are required. It installs for the current user (no admin rights) into `%LOCALAPPDATA%\Programs\Axle`, adds a Start menu entry and, if you leave the options ticked, the `axle` command on your PATH and "Open with Axle" on folders in Explorer. Your data lives in `~/.axle`. Updating means running a newer Setup over the old install; uninstalling is Windows Settings, Apps.

- **C# flows need the .NET 10 SDK on the PC** ([download](https://dotnet.microsoft.com/download/dotnet/10.0)). Axle's C# analyzer is a .NET 10 program that loads your solution with MSBuild, so the runtime alone is not enough. Without the SDK everything else works; the first time a C# flow is asked for, Axle shows one notice that says so. Other languages need nothing.
- Install into a short path (the default, `%LOCALAPPDATA%\Programs\Axle`, is fine). The longest file in Axle is about 155 characters below the install folder, and Windows stops at 260 in total, so an install folder that is itself 100 characters deep fails with "MoveFile failed; code 3".
- The installer is not code-signed yet, so Windows SmartScreen shows "Windows protected your PC" the first time: choose *More info*, then *Run anyway*.
- Axle is installed beside, not over, a stock VS Code or Code - OSS: it has its own app id, install folder, `axle://` link scheme and data folder.

**Build the installer yourself** (Windows, after `npm run setup`, plus the .NET 10 SDK and the Windows SDK, whose `signtool.exe` VS Code's build calls):

```bash
npm run installer                   # dist/Axle-Setup-<version>-x64.exe, per user
npm run installer -- --system       # also dist/Axle-Setup-<version>-x64-system.exe (all users, asks for admin rights)
npm run installer -- --fast         # reuse editor/VSCode-win32-x64 when VS Code, the core patch, product.json and the icon are unchanged since the last full build (dist/app-build.stamp says so): only Axle's own parts and Inno Setup run again, minutes instead of half an hour
npm run installer -- --full         # the full build whatever the stamp says (the default)
```

It builds the extensions, the canvas and the analyzer, runs VS Code's production build (15 to 40 minutes, several GB of RAM, about 20 GB of disk) and its Inno Setup step, and prints where the installer is. Pushing a `v*` tag builds and attaches it to a GitHub release (`.github/workflows/release.yml`).

## Requirements

| | macOS | Windows | Linux |
|---|---|---|---|
| Node 24.x (24.18 or newer; 25 will not do) and git | required | required | required |
| .NET 10 SDK, for C# flows | optional | optional | optional |
| Build tools for VS Code's native modules | Xcode Command Line Tools | Python 3 + Visual Studio Build Tools ("Desktop development with C++" plus its "MSVC Spectre-mitigated libs"; with Visual Studio 2026 also set `vs2022_install` to its folder and use npm 11.6+ / node-gyp 12+) | `build-essential`, `libx11-dev`, `libxkbfile-dev`, `libsecret-1-dev` |

`npm start` opens Axle in its own window (Electron, like any VS Code fork). `npm run web` serves the same editor to a browser instead. On Windows, `npm run shortcut` adds a Desktop and Start menu shortcut; it points at the Node that ran it, so run it again after you switch Node versions (nvm, fnm).

## Getting started

```bash
git clone https://github.com/bothuany/axle.git
cd axle
npm run setup
npm start
```

`npm run setup` clones VS Code 1.141.0 into `editor/vscode`, applies `editor/patches`, links the Axle extensions into it, and builds everything. The first run takes 10–20 minutes, mostly VS Code's `npm ci`. Running it again skips the clone, the patches, the links and (when nothing changed) `npm ci`; `--force-install` runs that anyway. If `editor/vscode` is at another VS Code version, or the patches do not apply to it, setup stops and says to delete it and run again. Steps that are optional (Electron's pre-launch, the server's Node, the app icon stamp, the C# analyzer) only warn when they fail, and the summary at the end lists them.

```bash
npm start -- path/to/project     # Axle window, opening a folder
npm run web -- path/to/project   # same editor, served for a browser
```

A folder is resolved from the directory you ran the command in. `npm run web` prints the URL to open, and it carries a random `?tkn=` token (new on every start) that the server requires: open that URL, not `http://127.0.0.1:8765` alone. The port is 8765, or `FLOW_PORT` when set (`FLOW_PORT=9000 npm run web`). The server listens on 127.0.0.1 only. It reads the token from a private temporary file instead of its command line, and it starts with `--accept-server-license-terms`, so running it accepts the VS Code server terms for you.

**Web mode is for your own code only.** The core patch (`webviewEndpoint` in `webClientServer.ts`) serves webviews from the same origin as the workbench, so that they work offline. A browser then no longer isolates a webview from the editor: do not open untrusted folders or install untrusted extensions in `npm run web`. The Electron window (`npm start`) is not affected.

**Your data folder is `~/.axle`.** Axle's `product.json` sets `dataFolderName` to `.axle`, so it does not share `~/.vscode-oss` with a stock Code - OSS build. Anything you already have in `~/.vscode-oss` (extensions you installed, state) is not migrated; copy what you want over by hand.

## Layout

```
editor/patches/     core patches to VS Code (branding, theme hooks, chat defaults, webview fixes)
editor/branding/    the app icon (.ico, .icns, .png), drawn by scripts/make-icons.py (needs Pillow)
editor/extensions/
  flow-view/        canvas host, endpoints list, Roslyn + polyglot providers, Claude Code /ide bridge
  flow-agent/       terminal agents and the Agents dock (plus ACP chat sessions, off by default)
  flow-harness/     harness map, hook studio, permission inbox, context budget
  flow-theme/       Axle's colour theme and defaults
ui/                 the canvas (React Flow + Monaco), built into one script the extension inlines
analyzer/           C# analyzer (.NET 10, Roslyn MSBuildWorkspace) serving flows over HTTP
scripts/            setup, start, build-extensions, install-shortcut and installer (Windows .exe), the same on every OS (lib.mjs starts programs without a shell)
```

## Developing

- Extensions: edit under `editor/extensions`, then `npm run build:extensions` and reload the window (`Developer: Reload Window`).
- Canvas: `npm run build:canvas`, then reload the window.
- Core patches: change files in `editor/vscode`, then regenerate the patch from there. New files must be known to git first, and the icons that `setup` copies into `resources/` must stay out of the patch:
  `git add -N src product.json && git diff HEAD -- build src product.json > ../patches/flow-core.patch`. Run it in Git Bash (or any POSIX shell): Windows PowerShell 5.1 writes `>` output as UTF-16, which breaks the patch.
- Tests: `cd editor/extensions/flow-view && npm test` builds the index worker and checks what it finds in every project under `test/fixtures` against `test/expected` (after an intended change: `UPDATE=1 npm test`, then read the diff). `npm run typecheck` there checks the types.
