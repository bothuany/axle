# Import from VS Code

Switching from VS Code (or VS Code Insiders, or Cursor) takes one step: Insilode brings over your settings, keyboard shortcuts, snippets, colour and icon theme and extensions, and merges them into what Insilode already has. It is the built-in extension `flow-import` (`editor/extensions/flow-import`).

## How to start it

- **On the first start.** When Insilode has no user settings yet and finds VS Code, VS Code Insiders or Cursor for your user, it shows one notification: *Coming from VS Code? Bring your settings, keyboard shortcuts, snippets, theme and extensions into Insilode.* with **Import from VS Code** and **Start fresh**. It is a notification in the corner, not a dialog: it never takes the focus, and it is shown once (closing it or choosing Start fresh is final; the command below still works). Someone who already has settings in Insilode, including everyone coming from Axle (whose settings are copied over on the first start), is not asked.
- **Any time.** The command **Insilode: Import from VS Code…** in the Command Palette.

When more than one editor is installed, the command first asks which one to import from (VS Code, VS Code Insiders, Cursor; the first-start notification offers the first of these that is installed). Then a list shows what that editor has, every item ticked, with counts:

| Item | What is imported |
|---|---|
| Settings | The keys of `settings.json`, except the theme keys and the ones listed under "Never imported" |
| Keyboard shortcuts | The entries of `keybindings.json` |
| Snippets | Every `*.json` and `*.code-snippets` file in `User/snippets` (global and language snippets) |
| Colour and icon theme | `workbench.colorTheme`, `workbench.iconTheme`, `workbench.productIconTheme`, the `workbench.preferred*ColorTheme` keys, `workbench.colorCustomizations`, `editor.tokenColorCustomizations`, `editor.semanticTokenColorCustomizations` |
| Extensions | Installed again, by id, from Open VSX (Insilode's extension gallery) |

Items the editor has nothing for are left out of the list. Untick what you do not want and press Enter; a progress notification (with Cancel) shows what is happening, and a last notification says what was imported, with **Show Details** for the full report.

## Where it reads from

Nothing in the other editor is changed. Insilode reads:

| | User folder (settings, keybindings, snippets) | Extension list |
|---|---|---|
| Windows | `%APPDATA%\Code\User`, `%APPDATA%\Code - Insiders\User`, `%APPDATA%\Cursor\User` | `%USERPROFILE%\.vscode\extensions`, `.vscode-insiders\extensions`, `.cursor\extensions` |
| macOS | `~/Library/Application Support/Code/User` (and `Code - Insiders`, `Cursor`) | `~/.vscode/extensions` (and `~/.vscode-insiders`, `~/.cursor`) |
| Linux | `~/.config/Code/User` (or `$XDG_CONFIG_HOME/Code/User`; and `Code - Insiders`, `Cursor`) | `~/.vscode/extensions` (and `~/.vscode-insiders`, `~/.cursor`) |

The extension list is the editor's own `extensions.json` in that folder; an extension it uninstalled but has not deleted yet (listed in `.obsolete`) is not imported, and an older install without `extensions.json` is read from its folder names (`publisher.name-1.2.3`). Only the settings of the other editor's default profile are read.

## How it merges

Merge, don't clobber:

- **A setting you already have in Insilode keeps your value.** The import only adds keys you have not set. A language block such as `"[python]": { ... }` is merged setting by setting.
- **Keyboard shortcuts are appended.** One you already have is not added twice (`ctrl+k ctrl+t` and `ctrl+K  ctrl+T` are the same chord), and a shortcut for a key you already bind in the same `when` context is not added: your binding stays.
- **Snippets:** a file Insilode does not have is copied as it is; a file it has gains only the snippets whose names it lacks.
- **Comments and layout stay.** The files are edited in place (jsonc-parser), not rewritten, so your comments and order survive.
- **The theme is applied last**, after the extensions, and only if Insilode then has that theme. A theme whose extension is not on Open VSX would otherwise leave Insilode on a fallback theme, so the report names it and Insilode keeps its own (Insilode Dark).
- **Extensions are installed from Open VSX**, one at a time, by their id. Insilode never copies the other editor's extension folders, so no Microsoft extension binaries are copied. An extension Open VSX does not have (most Microsoft ones, such as Remote - SSH, Live Share or Pylance) is listed in the final notification and the report instead of failing the import; the Extensions view may have an alternative. Extensions already installed are skipped.

### Never imported

These stay Insilode's whatever the other editor says:

- Insilode's own settings: `flow.*`, `flowHarness.*`, `flow-agent.*`, `insilode.*`, `axle.*`.
- Telemetry: `telemetry.*`.
- Microsoft account and sync services: `settingsSync.*`, `sync.*`, `workbench.cloudChanges.*` (and the experimental keys), `microsoft-authentication.*`, `remote.tunnels.access.*`.
- Experiments and services Insilode does not use: `workbench.enableExperiments`, `workbench.settings.enableNaturalLanguageSearch`, `extensions.gallery.*`.
- The update service: `update.*` (Insilode updates itself from its own releases).

## Backup and report

Before it writes anything, the import copies every file it is about to change (`settings.json`, `keybindings.json`, each snippet file it adds to) into `import-backups/<date and time>/` in Insilode's User folder:

- Windows: `%APPDATA%\Insilode\User\import-backups\`
- macOS: `~/Library/Application Support/Insilode/User/import-backups/`
- Linux: `~/.config/Insilode/User/import-backups/`

Next to the copies, `import-report.txt` lists what was added, what was kept, what was skipped and why, and which extensions were not found. The same report is in the **Insilode Import** output channel (**Show Details**). To undo an import, copy the files from the backup back into the User folder. Files that did not exist before the import have no backup: delete them to undo.

## Limits

- Settings, keybindings and snippets are written to Insilode's default profile.
- In a window connected to a remote machine (SSH, WSL, a container), the import runs where the workspace's extensions run: it reads that machine's home folder.
- A settings key from an extension Open VSX does not have is still imported (it does nothing until such an extension is installed). VS Code's Settings editor may mark it as unknown.
- Settings Sync, Copilot sign-in, workspace (`.vscode/settings.json`) settings and other editors' profiles are not imported. Workspace settings travel with the project anyway.
- In `npm run web` (a development mode), the source is read on the machine that runs the server and the settings are written to the browser's user data, as every setting in that mode is. That mode has no extension gallery (the web client only gets one when `product.json` has a `resourceUrlTemplate`), so extensions are not installed there: the report says so and lists them, and the rest of the import works.
- VS Code's old built-in theme names (`Default Dark Modern`, `Default Light Modern`, `Default Dark+`, `Default Light+`) are written under the names the themes have now (`Dark Modern`, ...), as VS Code itself reads them.

## For developers

- `src/sources.ts`: finding the editors and reading what they have (no `vscode`; the platform and folders are passed in). `src/merge.ts`: the merge rules, text in and text out. `src/extension.ts`: the notification, the command, the backup, the extension installs.
- Tests: `cd editor/extensions/flow-import && npm test` runs both modules against fixture homes in `test/fixtures` laid out as Windows, macOS and Linux keep them (an `XDG_CONFIG_HOME` case, an install without `extensions.json`, duplicates and `.obsolete`).
- `INSILODE_IMPORT_HOME=<folder>` makes the extension read that folder as the home folder (with `AppData/Roaming`, `Library/Application Support` or `.config` below it, by OS), so a probe imports a fixture, never your own VS Code. Set it on the process that runs the extension host, e.g. `INSILODE_IMPORT_HOME=... npm run web`.
