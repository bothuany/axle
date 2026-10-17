# Agent status outside the editor: survey and an optional Axle feature

Researched 2026-10-17. Web facts come from search results and README pages read that day. Repo pages did not show commit dates, so "maintenance" means what the README or search snippet said. Re-check anything you rely on.

## Recommendation (short)

1. **Build first (S–M): the app badge.** The Dock badge (macOS), taskbar overlay icon (Windows) and launcher count (Linux) show how many agents need you. It never takes focus. VS Code core already has the whole pipeline (`INativeHostService.setApplicationBadge`, `DockBadgeManager`, `setOverlayIcon`). Only the Agents dock count has no way into it. One small patch adds a workbench contribution plus a command, and flow-agent calls that command.
2. **Then (M): taskbar progress and flash.** `setProgressBar` shows "n working", and a one-shot flash on a new need. Flash is a request that the OS shows without moving focus.
3. **Later (L): a tray / menu-bar item** with per-agent states, and click-to-focus. It needs a main-process patch and a real design for click-to-focus.
4. **Do not build** a notch / Dynamic-Island overlay or an always-on-top mini window. Both are the focus-stealing and polish risk, and third-party apps already cover them by reading the same hooks (see section 1).
5. **Default:** badge **on** (it is passive and shows the same number as the dock badge), everything else **off** until proven. The setting stays a no-op in web mode.

## 1. Survey

### macOS notch / menu-bar session monitors (all third-party)

| App | Shows | Data source | License / state |
|---|---|---|---|
| [Vibe Notch](https://github.com/farouqaldori/vibe-notch) | Notch overlay; live sessions, approve/deny, chat history | Hooks in `~/.claude/hooks/` → Unix socket | Apache-2.0; ~2.5k stars; v1.3 April 2026; macOS 15.6+; sends anonymous Mixpanel launch events |
| [claude-notch](https://github.com/ConnorXTan/claude-notch) | One dot per session: yellow working, red pulsing needs input, green done; hover list by repo; click focuses terminal (AppleScript for iTerm/Terminal, VS Code/Cursor window lists); sound on red | Hooks (6 events in `settings.json`, backed up) write JSON per session to `~/.claude-notch/sessions/`; app watches the folder | MIT; macOS 14+; no-notch Macs get a menu-bar pill |
| [NotchBar](https://github.com/rikenpatel02/notchbar) | "Dynamic Island" session status, approve tool calls from the menu bar, CPU/mem/net stats | Hooks merged into `~/.claude/settings.json` | see repo |
| [claude-statistics](https://github.com/sj719045032/claude-statistics) | Notch panel of Claude / Codex / Gemini sessions by project, live status, inline Allow/Deny, usage and cost | hooks + transcripts | see repo |
| [Claude Peek](https://www.alexkurkin.com/guides/claude-peek) | Notch monitor | JSON events over a Unix socket to a Swift app | MIT per its guide |
| [Notchy](https://github.com/adamlyttleapps/notchy) | Floating Claude Code terminal in the notch | runs the CLI itself | free, open source; macOS 26+ |
| [Claude Usage Tracker](https://github.com/hamed-elfayome/Claude-Usage-Tracker) | Menu-bar usage limits; beta Dynamic Island with needs-input pulse | passive read-only hooks | see repo |
| [ClaudeBar](https://github.com/tddworks/ClaudeBar) | Quota monitor for Claude, Codex, Gemini; session-hook notifications | usage endpoints | see repo |
| Vibe Island ([guide](https://vibeisland.app/guides/claude-code-notifications-mac/)) | Answerable cards for Claude Code, Codex, Cursor | hooks | commercial |

Pattern: all of them use the same hook events Axle already receives (Notification: permission_prompt / idle_prompt, Stop, PreToolUse, UserPromptSubmit). None uses a status line.

### macOS scripts and launchers

- SwiftBar plugin [claude-quota](https://www.everydev.ai/tools/claude-quota): one usage bar per account in the menu bar. MIT. It reads the OAuth token from the Keychain and calls an undocumented endpoint, which its README says may break.
- [Raycast ccusage extension](https://raycast.com/nyatinte/ccusage): token and cost history and a menu-bar item, wrapping the ccusage CLI (reads transcript JSONL). I found no Raycast extension for live session state.
- CCSeva (Electron menu-bar usage app) and ClaudeWatch (SwiftUI + Python): usage only.

### Windows

- [claude-status-tray-windows](https://github.com/vyshnav-suresh/claude-status-tray-windows): tray icon coloured by state (permission / working / done / idle), a taskbar pill with project, activity and elapsed time, toasts for permission and completed turns, session-limit reset time. Node hooks write one JSON file per session to `%USERPROFILE%\.claude\statusbar\state.d\`, polled every 400 ms; the transcript tail gives reset times. MIT; 0 stars at capture; the README does not say whether hooks run under cmd or PowerShell.
- [claudeusagewin](https://github.com/sr-kai/claudeusagewin): .NET tray app, ~6 MB, MIT. Usage gauges for the 5-hour and weekly windows from the OAuth token and an undocumented API. Optional beta hooks give a floating widget of per-session state and a toast on done or needs-input.
- [Claude Notify](https://dev.to/yairdaniel11/claude-notify-desktop-notifications-for-claude-code-on-windows-50g6): tray app with a toast on completion; clicking tries to raise the right VS Code window.
- [Shilo's gist](https://gist.github.com/Shilo/2e064b7010ec172af89404ba0af34854): PowerShell hooks that play sounds and flash the taskbar button, and skip the flash when the terminal is already focused.
- Anthropic requests: [#30444](https://github.com/anthropics/claude-code/issues/30444) (taskbar progress while working) and [#67220](https://github.com/anthropics/claude-code/issues/67220) (native toast channel). Claude Code itself has neither, so the gap is real.
- Not found: a PowerToys-style tool, a Windows Widgets board or a Game Bar overlay for agent status. Treat these as unavailable options, not proven impossible. Widgets and Game Bar need packaged (MSIX) apps and are a poor fit for a fork.

### Agent products' own behaviour

- Cursor has sound notifications and an orange dot on chat tabs that need attention. Forum requests ([1](https://forum.cursor.com/t/push-notifications-mobile-desktop-when-agent-needs-user-input-or-approval/148230), [2](https://forum.cursor.com/t/os-notifications-for-cli-claude-code-parity/155106)) ask for OS notifications. So there is no dock badge for agent-needs-input in Cursor.
- Codex CLI has two notification events (turn complete, approval requested), sent as terminal escape codes or a bell ([overview](https://codex.danielvaughan.com/2026/04/10/codex-cli-agent-notifications-desktop-alerts-monitoring/)).
- Claude Code notifies on completion and on permission prompts, but only in terminals that support it, or through a hook.
- I could not confirm anything about the Claude desktop app, Codex app, Warp or Conductor menu items. A search found nothing. Verify by hand before citing them.
- VS Code's own Sessions window has a dock/taskbar/launcher badge: `sessions.showApplicationBadge` and `sessions.applicationBadge` (needs-input / unread / CI-failing) in `editor/vscode/src/vs/sessions/contrib/sessions/electron-browser/sessionsApplicationBadge.ts`. It counts VS Code's own sessions, not Axle's terminal agents, but it is the model to copy.

Takeaways: every popular tool uses hooks and shows three colours (working / needs you / done); the cross-platform floor is a badge and a toast; the notch apps are macOS-only and none is cross-platform. Axle already holds the exact data they scrape, with more of it (need kind, context, cost, worktree).

## 2. What Axle could do

### What exists

- `Agents.sessions` hold `state` (`starting | working | blocked | done | idle | unknown | ended`), a `need` (approval / question / error) and `unread` ([attention.ts:185-204](../../editor/extensions/flow-agent/src/attention.ts)). `attentionKind(s)` is the single definition of "needs you" and `Agents.needsYou` counts it ([agents.ts:864](../../editor/extensions/flow-agent/src/agents.ts)).
- The dock sets a **view badge** with that count ([dock.ts:88](../../editor/extensions/flow-agent/src/dock.ts)). That badge stays inside the workbench: nothing in core feeds extension view badges to the OS (the only callers of `setApplicationBadge` are the Sessions contribution and the native host).
- Notifications today ([notify.ts](../../editor/extensions/flow-agent/src/notify.ts)): `AttentionNotifier` calls `showInformationMessage` / `showWarningMessage` with a "Show Terminal" button, only when the session is not watched (`isWatched`: window focused and that terminal active). Per-kind switches `flow.agents.notify.{approval,question,error,done,quiet}`. It takes no focus unless the button is pressed. VS Code decides whether the OS also shows them.
- Patch mechanism: `editor/patches/*.patch` (one file, `flow-core.patch`) is applied to `editor/vscode` by [scripts/setup.mjs](../../scripts/setup.mjs) (`git apply`, skipped when already applied, LF-only). `editor/vscode` is generated and never edited by hand. Existing patches touch workbench CSS, product.json, the webview shell and the extension build.

### The reachable surface

| Capability | From a built-in extension alone | Needs |
|---|---|---|
| Notifications (in-window, OS if VS Code relays) | yes (today) | nothing |
| View badge / status-bar item | yes | nothing; in-window only |
| Dock / launcher badge count (macOS, Linux) | no | small renderer patch |
| Windows taskbar overlay icon | no | the same patch (core draws the icon in the renderer and calls `setOverlayIcon`) |
| Taskbar progress, flash frame | no | small main-process patch plus IPC |
| Tray / menu-bar item | no | main-process patch: `Tray`, `Menu`, IPC; icons per state |
| Native notification with action buttons | partly (`showInformationMessage` buttons) | patch for Electron `Notification` with `actions` (works on macOS; Windows toast actions need AUMID setup, and `win32AppUserModelId` is already `Axle.Axle`) |
| Always-on-top mini window | no | main-process patch; focus risk, skip |
| Web mode | in-page only | see below |

**Badge patch design (the cheapest, highest value).** Add a workbench contribution, in the electron-browser layer, that registers a command, for example `flow.desktop.setBadge(count)`. The command calls the existing `INativeHostService.setApplicationBadge({ count, description, iconDataURL })`. Copy the icon drawing from `SessionsApplicationBadge` (a 32 px canvas, max 9, theme colours, Windows only). Nothing in electron-main changes. Add it to `flow-core.patch` (or a second numbered patch so `setup.mjs` applies it on its own). flow-agent calls `vscode.commands.executeCommand('flow.desktop.setBadge', n)` when the count changes, guarded by the setting. Note the arch rule: extensions talk through registered commands, and `test/arch/commands.test.mjs` requires every command one extension invokes to be registered. A command registered by core (not an extension) will need an allowlist entry there, or flow-agent should invoke it behind `getCommands().includes(...)` and a documented exception.

**Progress and flash.** Extend the same contribution with `setProgress(mode, fraction)` and `flash()`, through a new `INativeHostService` method plus `nativeHostMainService` handler calling `BrowserWindow.setProgressBar` and `flashFrame(true)`. Use `indeterminate` while any agent is working and `error` (red) while one is blocked, but only on Windows. macOS Dock shows progress through the same call. `flashFrame` on Windows flashes the taskbar button without activating the window. On macOS, `app.dock.bounce('informational')` bounces only while the app is inactive and does nothing when it is active, which is the behaviour we want. Skip `dock.bounce('critical')`, since it keeps bouncing until the app is focused.

**Tray.** A main-process service owns the `Tray`, with a template icon on macOS and three coloured icons on Windows. The renderer pushes a small model, `[{id, name, cli, state, attention}]`, over a new IPC channel. The menu lists agents ranked like the dock, with a click that sends the id back to the renderer. The renderer then runs the existing `flow.agents.show` path, which focuses the window and terminal. That click is a user gesture, so focusing is allowed, but the code path must be explicit and the tray must never focus on its own. Costs: icon assets per platform and theme, a lifecycle across several windows (one tray per app, merged across windows, like `DockBadgeManager`), Linux tray quirks (GNOME hides legacy trays), and a decision on what "click" does when the window is minimised.

**Notifications with actions.** Electron `Notification` with `Approve/Deny` buttons is tempting but risky: approving tool calls from a toast needs a channel back into the permission flow that flow-harness owns, plus an allowlist and a trust story. The notch apps do this over their hook socket; Axle's hooks are observe-only by design, so keep it observe-only: toasts only link to the session.

**Mini window.** Always-on-top, no-focus (`showInactive`, `focusable: false`) windows are possible in Electron, but the rule is "no window takes focus on its own", it needs per-OS testing, and a notch overlay is what the third-party apps do well. Not recommended.

**Web mode (`npm run web`).** There is no OS shell integration. Options: the page title and favicon can carry a count, `navigator.setAppBadge` works only for installed PWAs, and the browser `Notification` API needs permission and a user gesture the first time. In an extension host (Node, remote) none of these is reachable from `vscode.*`; they would need a workbench-layer contribution in the patch. Plan: do nothing in web mode, keep the dock badge and the in-window notification as the web story, and revisit favicon/title only if web becomes a target.

### What the extension must compute (and reuse)

- Count = `Agents.needsYou` (already respects `unread` for done turns and error visibility). A separate `flow.agents.notify.quiet` does not hide the badge; it only stops notifications. Decide whether a done-but-unread turn counts: it does today in the dock badge, and the OS badge should agree with the dock.
- Working count = sessions with `state === 'working'`.
- The `onDidChange` event already fires on every hook. Coalesce updates (same 250 ms as the dock) and skip no-op values so the badge is not repainted per event.

## 3. Plan, risks, settings

### Order and effort

| Step | Effort | What it takes |
|---|---|---|
| 1. App badge (dock / overlay / launcher) | S–M | one workbench contribution + command in the patch; ~40 lines in flow-agent (`desktop.ts`); setting; arch-test allowlist; tests with a fake command; manual check per OS |
| 2. Taskbar progress + one-shot flash | M | new native-host method and main handler; patch tests; Windows and macOS manual checks |
| 3. Tray / menu-bar | L | main-process service, IPC, icons, multi-window merge, click-to-focus, Linux fallback |
| 4. Native toasts with actions | M–L | only after 3; observe-only (no approve) |
| Notch / mini window | not recommended | |

### Risks

- **Focus stealing (hard rule).** Allowed: badge, overlay, progress, flash, bounce only while inactive, toast with a link. Forbidden: `focus()`, `show()` of any window, `app.focus({steal:true})`, `dock.bounce('critical')`, a window that appears over other apps. Everything in step 1–2 is passive. Clicking a tray item or toast is the user's gesture and may focus; document that as the only focusing path. Add a semgrep rule or an arch test that forbids `focus(`, `showInactive`, `alwaysOnTop` and `bounce('critical')` in the patch's new files.
- **Patch drift.** More patched core files mean more rebase pain. Keep it to one new file plus one registration line (the badge contribution) and one native-host method, in a separate patch file so a failed apply names it.
- **Overlap with core.** Core's Sessions badge and Axle's can both call `setApplicationBadge`. They share `DockBadgeManager` per window id, so counts add up if both are on. Axle should only count its own agents and the Sessions badge should stay off (it is off by default on stable builds; check `product.quality` for Axle).
- **Windows overlay.** The icon is drawn in the renderer and goes away if the renderer reloads; clear it on dispose and on count 0.
- **Privacy.** Badge and tray show counts and state only. Never put prompt text or file names in a tray tooltip by default (the screen may be shared), and never send anything off the machine.
- **Dock badge semantics.** macOS shows a number that persists across Spaces; with a count of 0 it must be cleared, not set to an empty string.

### Settings design

```jsonc
"flow.agents.desktop.badge":    { "type": "boolean", "default": true,
  "description": "Show how many agents need you on the Dock, taskbar or launcher icon." },
"flow.agents.desktop.badgeCounts": { "enum": ["needsYou", "needsYouAndDone"], "default": "needsYou" },
"flow.agents.desktop.progress": { "type": "boolean", "default": false,
  "description": "Taskbar/Dock progress: indeterminate while agents work, red while one waits for approval." },
"flow.agents.desktop.flash":    { "type": "boolean", "default": false,
  "description": "Flash the taskbar button once when an agent starts needing you while the window is in the background." },
"flow.agents.desktop.tray":     { "type": "boolean", "default": false,
  "description": "Tray / menu-bar item listing agents by state (restart required)." }
```

- Everything respects `flow.agents.notify.quiet` except the badge (a count is not an interruption).
- Settings are read live; the contribution clears the badge, overlay and progress when switched off.
- In web mode the commands do not exist: flow-agent checks `vscode.commands.getCommands()` for `flow.desktop.setBadge` once at activation and does nothing when it is missing, so one build works in both modes.
- Argument for badge default-on: it is the same number as the dock badge, passive, and what Cursor users are asking for. Argument against: a patched-core dependency a user may not expect, and a number on the Dock icon is visible on a shared screen. Recommended default: **on**, with the opt-out one setting away. Progress, flash and tray default **off**.

## 4. Open questions for the user

1. Is a macOS notch overlay wanted at all, or is the Dock badge plus an optional menu-bar item enough? (Recommended: skip the notch.)
2. Should a done-but-unread turn count in the OS badge, as it does in the dock badge? (Recommended: yes, one rule everywhere.)
3. Is there a Mac available to test steps 1–3? The Dock badge, bounce and menu-bar template icons cannot be verified on this Windows machine, and the work here was research only: nothing was built or run.
