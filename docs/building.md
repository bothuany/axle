# Building and running Axle

## Install

Axle is installed from the files on the [Releases](https://github.com/bothuany/axle/releases) page: an installer for Windows, an app for macOS and packages for Linux, with `SHA256SUMS.txt` beside them. Each one ships with everything it needs, so no Node, git or build tools are required. Your data lives in `~/.axle` on every OS. Axle installs beside, not over, a stock VS Code or Code - OSS: it has its own app id (bundle id on macOS, desktop entry on Linux), install folder, `axle://` link scheme and data folder.

**C# flows need the .NET 10 SDK** ([download](https://dotnet.microsoft.com/download/dotnet/10.0)), whatever the OS. Axle's C# analyzer is a .NET 10 program that loads your solution with MSBuild, so the runtime alone is not enough. Without the SDK everything else works; the first time a C# flow is asked for, Axle shows one notice that says so. Other languages need nothing.

> **Not published yet:** `winget install bothuany.Axle`, `brew install --cask bothuany/tap/axle` and an APT repository are prepared in [`packaging/`](../packaging/README.md) but not submitted or hosted. Until they are, install from the release files below; updating means installing the newer release over the old one.
>
> **macOS and Linux packages are new:** 0.1.0 is the first release that ships them. They are built and packaged on GitHub's runners, but have not been run on a Mac or a Linux desktop yet; please [report problems](https://github.com/bothuany/axle/issues).

### Windows

Download `Axle-Setup-<version>-x64.exe` and run it. It installs for the current user (no admin rights) into `%LOCALAPPDATA%\Programs\Axle`, adds a Start menu entry and, if you leave the options ticked, the `axle` command on your PATH and "Open with Axle" on folders in Explorer. Updating means running a newer Setup over the old install; uninstalling is Windows Settings, Apps.

- Install into a short path (the default, `%LOCALAPPDATA%\Programs\Axle`, is fine). The longest file in Axle is about 155 characters below the install folder, and Windows stops at 260 in total, so an install folder that is itself 100 characters deep fails with "MoveFile failed; code 3".
- The installer is not code-signed yet, so Windows SmartScreen shows "Windows protected your PC" the first time: choose *More info*, then *Run anyway*.
- Later: `winget install bothuany.Axle` (not submitted yet).

### macOS

Download `Axle-<version>-darwin-arm64.dmg` (Apple silicon) or `Axle-<version>-darwin-x64.dmg` (Intel), open it and drag Axle to Applications. The `.zip` files hold the same app. For the `axle` command, choose *Shell Command: Install 'axle' command in PATH* from the Command Palette.

- **Axle is not signed with an Apple Developer ID yet**, so macOS blocks the first launch. Open it once, then go to *System Settings > Privacy & Security* and choose *Open Anyway* (then confirm with your password). If macOS says Axle "is damaged and can't be opened", clear the download quarantine instead: `xattr -dr com.apple.quarantine /Applications/Axle.app`.
- Later: `brew install --cask bothuany/tap/axle` (the tap does not exist yet). The cask also puts `axle` on your PATH, and `brew upgrade` will keep it current.

### Linux

Download `axle_<version>_amd64.deb` and install it on Debian 12, Ubuntu 22.04 or newer:

```bash
sudo apt install ./axle_<version>_amd64.deb
```

It installs into `/usr/share/axle`, adds `axle` to `/usr/bin` and a desktop entry (`io.github.bothuany.Axle.desktop`, icon `axle`), so it installs beside a VS Code or Code - OSS package. Unlike VS Code's package, it does not add any apt repository. For Fedora and other RPM distributions there is `axle-<version>-1.x86_64.rpm` (`sudo dnf install ./axle-*.rpm`), and `Axle-<version>-linux-x64.tar.gz` unpacks anywhere (run `Axle-linux-x64/axle`). All are x64 only.

- Later: an APT repository so that `sudo apt install axle` and `apt upgrade` work ([how it would be hosted](../packaging/apt/README.md); not set up yet).

### Build the packages yourself

**The Windows installer** (Windows, after `npm run setup`, plus the .NET 10 SDK and the Windows SDK, whose `signtool.exe` VS Code's build calls):

```bash
npm run installer                   # dist/Axle-Setup-<version>-x64.exe, per user
npm run installer -- --system       # also dist/Axle-Setup-<version>-x64-system.exe (all users, asks for admin rights)
npm run installer -- --fast         # reuse editor/VSCode-win32-x64 when VS Code, the core patch, product.json and the icon are unchanged since the last full build (dist/app-build.stamp says so): only Axle's own parts and Inno Setup run again, minutes instead of half an hour
npm run installer -- --full         # the full build whatever the stamp says (the default)
```

It builds the extensions, the canvas and the analyzer, runs VS Code's production build (15 to 40 minutes, several GB of RAM, about 20 GB of disk) and its Inno Setup step, and prints where the installer is. Pushing a `v*` tag builds and attaches it to a GitHub release (`.github/workflows/release.yml`).

**The macOS and Linux packages** (on that OS, after `npm run setup`, plus the .NET 10 SDK; on Linux also `fakeroot`, and `rpm` for the .rpm):

```bash
npm run package                     # macOS: dist/Axle-<version>-darwin-<arch>.zip and .dmg; Linux: dist/axle_<version>_amd64.deb, the .rpm and the .tar.gz
```

It does what the installer does up to VS Code's production build, then signs the app ad hoc and makes the zip and the disk image (macOS), or runs VS Code's deb and rpm packaging with Axle's control file and maintainer scripts (Linux). The packages are built for the machine's own processor. A `v*` tag builds all of them on GitHub's runners and attaches them to the release.

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
playground/         the browser playground: the canvas, the dock and a scripted agent on demo data from the real index (GitHub Pages)
analyzer/           C# analyzer (.NET 10, Roslyn MSBuildWorkspace) serving flows over HTTP
scripts/            setup, start, build-extensions, install-shortcut and installer (Windows .exe), the same on every OS (lib.mjs starts programs without a shell)
```

## Developing

- Extensions: edit under `editor/extensions`, then `npm run build:extensions` and reload the window (`Developer: Reload Window`).
- Canvas: `npm run build:canvas`, then reload the window.
- Core patches: change files in `editor/vscode`, then regenerate the patch from there. New files must be known to git first, and the icons that `setup` copies into `resources/` must stay out of the patch:
  `git add -N src product.json && git diff HEAD -- build src product.json > ../patches/flow-core.patch`. Run it in Git Bash (or any POSIX shell): Windows PowerShell 5.1 writes `>` output as UTF-16, which breaks the patch.
- After a pull that changes `editor/patches/flow-core.patch`, `editor/vscode` still carries the old patch: `npm run setup` stops with "does not apply", and `npm run installer` / `npm run package` say the patches are missing. When only `product.json` changed in the patch (as when Axle's macOS bundle id and Linux desktop and icon names replaced Code - OSS's), re-apply just that file, then run setup:
  `git -C editor/vscode checkout -- product.json && git -C editor/vscode apply --include=product.json ../patches/flow-core.patch`. After any other patch change, delete `editor/vscode` and run `npm run setup` for a clean checkout.
- Tests: `cd editor/extensions/flow-view && npm test` builds the index worker and checks what it finds in every project under `test/fixtures` against `test/expected` (after an intended change: `UPDATE=1 npm test`, then read the diff). `npm run typecheck` there checks the types.

## The browser playground

`playground/` is the site at https://bothuany.github.io/axle/: a page that presents Axle with live tiles on a fictional demo project: the real flow canvas on an endpoint, a scripted Claude that the Agents dock and the status overlay follow, the agent's change on the canvas (green and red, Keep and Undo), and the harness scan of the project. The canvas, the dock page, the overlay page and the harness map are Axle's own, built from the demo project by the real code (what each part is, and what is scripted, in [playground/README.md](../playground/README.md)). From the repository root:

```bash
(cd ui && npm ci)
(cd editor/extensions/flow-view && npm ci && node esbuild.mjs)
(cd editor/extensions/flow-harness && npm ci)
node scripts/playground-data.mjs        # writes playground/public/data and playground/public/pages (not committed)
cd playground && npm ci
npm run typecheck && npm run build      # the site is in playground/dist
npm run test:e2e                        # plays the demo in headless Chrome
npm run preview                         # http://127.0.0.1:4173/axle/ (the path GitHub Pages serves it under)
```

`npm run dev` in `playground/` serves it with hot reload. In Git Bash on Windows, `/axle/` in the preview script is rewritten to a Windows path: run `npm run preview` from PowerShell or set `MSYS_NO_PATHCONV=1`. `npm run arch` keeps `playground/` to imports from `ui/`, `protocol/` and four vscode-free files of flow-agent. `.github/workflows/playground.yml` deploys it on every push to `main` (and `ci.yml` builds and tests it on pull requests); Pages must be enabled once with the source "GitHub Actions".
