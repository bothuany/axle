# Contributing to Insilode

Bug reports, fixes and new language support are welcome. For anything larger than a fix, open an issue first so we can agree on the approach before you spend time on it.

## Setup

Follow "Getting started" in [docs/building.md](docs/building.md): `npm run setup` clones VS Code, applies `editor/patches` and builds everything (10–20 minutes the first time). Node 24.18 or newer (not 25) and git are required; the .NET 10 SDK is only needed for the C# analyzer.

## Where things live

- `editor/extensions/*`: the four built-in extensions (TypeScript, bundled with esbuild).
- `ui/`: the canvas (React Flow + Monaco).
- `analyzer/`: the C# analyzer (.NET 10, Roslyn).
- `editor/patches/flow-core.patch`: Insilode's changes to VS Code itself. Keep it as small as you can; prefer an extension.

## Before you open a pull request

CI runs these; run them locally first:

```bash
# architecture rules and tests (root)
npm ci && npm run arch
# canvas
cd ui && npm ci && npm run typecheck && npm run build
# flow-view (needs `npm run setup` for typecheck)
cd editor/extensions/flow-view && npm ci && npm test
# analyzer
dotnet build analyzer
```

Optional local scans: `npm run semgrep` (needs `semgrep` on PATH or Docker) and SonarQube (`tools/sonarqube/README.md`).

- A new language or framework needs a fixture under `editor/extensions/flow-view/test/fixtures` and its expected output under `test/expected`. After an intended change, run `UPDATE=1 npm test` and read the diff before committing it.
- If you change the core patch, regenerate it as described in "Developing" in [docs/building.md](docs/building.md) (in Git Bash, not Windows PowerShell 5.1, which writes UTF-16).
- Keep changes focused: one fix or feature per pull request, with a message that says why.
- Match the style of the surrounding code; there is no separate formatter to run.

## Licence and the CLA

Insilode is released under the [MIT License](LICENSE). Before your first pull request can be merged, you sign the [Contributor License Agreement](CLA.md) once: a bot comments on the pull request, and you reply with the sentence it gives you. You keep the copyright of your work; the agreement lets the project keep maintaining it and, if that is ever needed, ship it under other licence terms. Code you contribute stays available under the MIT License in the releases that contain it.

If you contribute as part of your job, make sure your employer allows it (see point 5 of the CLA).

The Insilode name and logo are not covered by the code licence: see [TRADEMARKS.md](TRADEMARKS.md).

Be kind: see the [code of conduct](CODE_OF_CONDUCT.md). Questions and ideas are welcome in [Discussions](https://github.com/bothuany/axle/discussions); bugs go to issues.
