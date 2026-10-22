# Messaging

How Insilode describes itself, so the site, the README, the film and release notes say the same thing. Decided 2026-10-22.

## Positioning

Insilode is a **code editor built on VS Code** that shows how your code runs. A visitor should know within one screen that it is an editor they can switch to (with their extensions, themes and keybindings), and only then what it adds.

## Headline and subhead

- **Headline (slogan):** Every code editor shows how code is stored. Insilode shows how it runs.
  - On the site, "Insilode" is in the light accent blue (`#9aa8ff`, 8.5:1 on the page). In plain text, such as the README, it is bold instead.
  - Each sentence starts a new line. The lines wrap evenly, with no word left alone on a line, and "Insilode" never splits.
- **Subhead, always right under it:** Built on VS Code, so your extensions, themes and keybindings work. Plus a live canvas of every request, a review of what your agents changed, and a dock that runs Claude Code and Codex side by side. With the subhead, "code editor" and "VS Code" are both in the first screen.
- **Page title:** Insilode, the code editor that shows how code runs. It must stay under 60 characters for search results; `og:title` carries the full slogan.
- **Earlier headline (until 2026-10-22):** The code editor that shows how your code runs. It still works as a one-line description.

Show the real editor window (explorer, a code tab, a canvas tab, the terminal with an agent, the Agents dock) right under the headline. Pictures are captures of the real app, never mock-ups.

## Visual rule

Every marketing visual is dark: the website (dark by default, and the only theme), screenshots of the editor (a dark VS Code theme, Default Dark Modern), the README images and the film. Flow cards in a picture are zoomed so their code can be read.

## Type

- **Instrument Sans** sets headings and text, and **JetBrains Mono** sets code-ish accents (command names, numbers, chips, terminal lines). Both are OFL-1.1 and self-hosted from Fontsource (`@fontsource-variable/instrument-sans`, `@fontsource-variable/jetbrains-mono`). There is no font CDN.
- Headings are weight 650 at normal width, with slightly tight tracking.
- Use the same pair in any new marketing visual. The film keeps its own type (`docs/film`).

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
