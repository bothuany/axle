# Messaging

How Insilode describes itself, so the site, the README, the film and release notes say the same thing. Decided 2026-10-22.

## Positioning

Insilode is a **code editor built on VS Code** that shows how your code runs. A visitor should know within one screen that it is an editor they can switch to (with their extensions, themes and keybindings), and only then what it adds.

## Headline and subhead

- **Headline:** The code editor that shows how your code runs.
- **Subhead:** Built on VS Code, so your extensions, themes and keybindings work. Plus a live canvas of every request, a review of what your agents changed, and a dock that runs Claude Code and Codex side by side.
- **Page title:** Insilode: the code editor that shows how your code runs

Show the real editor window (explorer, a code tab, a canvas tab, the terminal with an agent, the Agents dock) right under the headline. Pictures are captures of the real app, never mock-ups.

## What carries over from VS Code

1. **Your extensions**, from Open VSX, the open extension registry VS Code forks use.
2. **Your themes, keybindings and settings**: the same commands, shortcuts and `settings.json`.
3. **Your profile**: export it in VS Code with **Profiles: Export Profile…**, import it in Insilode with **Import Profile…** in **Preferences: Open Profiles (UI)**.

<!-- TODO(import-from-vscode): the one-click "Import from VS Code" is in PR #28, not released. When it ships, claim 3 becomes: "Import your settings, keybindings, snippets and theme from VS Code or Cursor; extensions available on Open VSX are installed, the rest are listed." -->

Never say "all your extensions": only the ones on Open VSX install.

Say it once, plainly, wherever the claims appear: a few of Microsoft's own extensions (Pylance, C# Dev Kit, the Remote - SSH / WSL / Dev Containers family, GitHub Copilot) are licensed for Microsoft's builds only and are not on Open VSX; open alternatives are.

## What it adds

Frame every feature as something Insilode adds to VS Code, in this order: the canvas (how a request runs, across services), the change set (what an agent changed, on the flow), the Agents dock (Claude Code, Codex and any CLI side by side), the harness map.

## Vocabulary

| Say | Do not say |
| --- | --- |
| code editor | IDE replacement, AI IDE, platform |
| built on VS Code; a fork of VS Code (Code - OSS) | VS Code extension, plugin, "VS Code with a skin" |
| Open VSX | the VS Code Marketplace (Insilode cannot use it) |
| runs Claude Code and Codex (as their real tools, in terminals) | replaces Claude Code, its own AI, its own model |
| the canvas, the flow, a card | diagram tool, visualizer |
| Insilode | Axle (the old name) |

Keep "Microsoft" out of anything that could read as endorsement: Insilode is built on VS Code and is not affiliated with Microsoft.
