# Security policy

## Reporting a vulnerability

Please do not open a public issue for a security problem. Report it privately through GitHub: on the repository's **Security** tab, choose **Report a vulnerability** ([private vulnerability reporting](https://github.com/bothuany/axle/security/advisories/new)).

Include what you found, the steps to reproduce it, and the Insilode version or commit. You can expect an acknowledgement within a few days. Insilode is maintained by volunteers, so fix times vary; we will tell you when it is fixed and credit you if you wish.

## Scope

In scope: Insilode's own code (the extensions, the canvas, the analyzer, the MCP server and its loopback bridge in `~/.insilode/bridge`, the scripts and the core patch).

Out of scope: vulnerabilities in VS Code itself (report those to [Microsoft](https://github.com/microsoft/vscode/security/policy)), in Claude Code or Codex, or in third-party extensions.

## Things to know

- `npm run web` is for your own code only. The core patch serves webviews from the workbench origin, so a browser does not isolate them from the editor. Do not open untrusted folders or install untrusted extensions in web mode. The Electron window is not affected.
- The web server listens on 127.0.0.1 only and requires a random per-start token.
- The Windows installer is not code-signed yet.
