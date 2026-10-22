/*---------------------------------------------------------------------------------------------
 *  Import from VS Code: brings another editor's settings, keyboard shortcuts, snippets, theme and extensions into
 *  Insilode, merged into what the user already has (see merge.ts) after a backup of every file it changes.
 *
 *  Offered once, as a notification, on a first start (no user settings yet, and VS Code, VS Code Insiders or Cursor is
 *  installed); the command `Insilode: Import from VS Code…` runs it any time. Extensions are installed by id from
 *  Insilode's gallery (Open VSX); nothing is copied from the other editor's extensions folder.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { homedir } from 'node:os';
import { findSources, readSource, type Env, type Platform, type Source, type SourceContent } from './sources';
import { applicableTheme, hasSettings, isNoGallery, isNotFound, mergeSnippets, planKeybindings, planSettings, writeKeybindings, writeSettings, type ThemeKind } from './merge';

const COMMAND = 'flow.importFromVSCode';
/** Set once the first-start offer was shown (or not needed), so it never comes back. */
const OFFERED = 'flowImport.offered';

let log: vscode.LogOutputChannel;

export function activate(context: vscode.ExtensionContext) {
	log = vscode.window.createOutputChannel('Insilode Import', { log: true });
	context.subscriptions.push(
		log,
		vscode.commands.registerCommand(COMMAND, () => runImport(context)),
	);
	void offerOnFirstStart(context).catch(e => log.warn(`First-start offer: ${(e as Error).message}`));
}

export function deactivate() {
	// Nothing to flush: every write is awaited inside the command.
}

/**
 * Where to look for the other editors. `INSILODE_IMPORT_HOME` stands in for the home folder (and the application-data
 * folders under it), so tests and probes import from a fixture instead of the developer's own VS Code.
 */
function sourceEnv(): Env {
	const fake = process.env.INSILODE_IMPORT_HOME;
	const platform = (['win32', 'darwin'].includes(process.platform) ? process.platform : 'linux') as Platform;
	if (fake) {
		return { platform, home: fake };
	}
	return { platform, home: homedir(), appData: process.env.APPDATA, xdgConfigHome: process.env.XDG_CONFIG_HOME };
}

/**
 * Insilode's own User folder, as a URI the workbench's file service resolves. In the desktop app it is two levels above
 * this extension's global storage; in a browser (web mode) user data lives in the browser under `vscode-userdata:/User`,
 * not on the server, so it is addressed there. Settings, keybindings and snippets of the default profile live in it.
 */
function userDir(context: vscode.ExtensionContext): vscode.Uri {
	return vscode.env.uiKind === vscode.UIKind.Web
		? vscode.Uri.from({ scheme: 'vscode-userdata', path: '/User' })
		: vscode.Uri.joinPath(context.globalStorageUri, '..', '..');
}

async function readText(uri: vscode.Uri): Promise<string | undefined> {
	try {
		return new TextDecoder().decode(await vscode.workspace.fs.readFile(uri));
	} catch {
		return undefined;
	}
}

async function writeText(uri: vscode.Uri, text: string): Promise<void> {
	await vscode.workspace.fs.writeFile(uri, new TextEncoder().encode(text));
}

async function offerOnFirstStart(context: vscode.ExtensionContext) {
	if (context.globalState.get(OFFERED)) {
		return;
	}
	const sources = findSources(sourceEnv());
	if (!sources.length) {
		return;
	}
	await context.globalState.update(OFFERED, true);
	// Someone who already set Insilode up (or came from Axle, whose settings were copied over) is not asked.
	if (hasSettings(await readText(vscode.Uri.joinPath(userDir(context), 'settings.json')))) {
		return;
	}
	const source = sources[0];
	const name = source.product.name;
	const importIt = `Import from ${name}`;
	// A notification, not a modal dialog or an editor tab: it waits in the corner and never takes the focus.
	const pick = await vscode.window.showInformationMessage(
		`Coming from ${name}? Bring your settings, keyboard shortcuts, snippets, theme and extensions into Insilode. What you have now is backed up first.`,
		importIt,
		'Start fresh',
	);
	log.info(`First-start offer for ${name}: ${pick ?? 'dismissed'}.`);
	if (pick === importIt) {
		await runImport(context, source);
	}
}

type ItemId = 'settings' | 'keybindings' | 'snippets' | 'theme' | 'extensions';
interface Item extends vscode.QuickPickItem {
	id: ItemId;
}

function items(content: SourceContent): Item[] {
	const settings = planSettings(undefined, content.settings);
	const shortcuts = planKeybindings(undefined, content.keybindings).add.length;
	const themes = settings.theme.filter(t => typeof t.value === 'string').map(t => t.value as string);
	const all: (Item & { count: number })[] = [
		{ id: 'settings', count: settings.add.length, label: 'Settings', description: plural(settings.add.length, 'setting'), detail: 'Added to yours: a setting you already have in Insilode keeps your value.' },
		{ id: 'keybindings', count: shortcuts, label: 'Keyboard shortcuts', description: plural(shortcuts, 'shortcut') },
		{ id: 'snippets', count: content.snippets.length, label: 'Snippets', description: plural(content.snippets.length, 'file') },
		{ id: 'theme', count: settings.theme.length, label: 'Colour and icon theme', description: [...new Set(themes)].join(', ') || plural(settings.theme.length, 'setting') },
		{ id: 'extensions', count: content.extensions.length, label: 'Extensions', description: `${plural(content.extensions.length, 'extension')}, from Open VSX`, detail: 'Installed again from Open VSX. Those it does not have are listed afterwards.' },
	];
	return all.filter(i => i.count > 0).map(({ count: _count, ...i }) => ({ ...i, picked: true }));
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

async function pickSource(sources: Source[]): Promise<Source | undefined> {
	if (sources.length === 1) {
		return sources[0];
	}
	const pick = await vscode.window.showQuickPick(
		sources.map(source => ({ label: source.product.name, description: source.userDir, source })),
		{ title: 'Import from', placeHolder: 'Which editor do you want to import from?' },
	);
	return pick?.source;
}

async function runImport(context: vscode.ExtensionContext, preset?: Source) {
	const env = sourceEnv();
	const source = preset ?? await pickSource(findSources(env));
	if (!source) {
		if (!preset && !findSources(env).length) {
			void vscode.window.showInformationMessage('Insilode found no VS Code, VS Code Insiders or Cursor settings to import for this user.');
		}
		return;
	}
	const content = readSource(source);
	const list = items(content);
	if (!list.length) {
		void vscode.window.showInformationMessage(`${source.product.name} has nothing to import: no settings, shortcuts, snippets or extensions in ${source.userDir}.`);
		return;
	}
	const chosen = await vscode.window.showQuickPick(list, {
		title: `Import from ${source.product.name}`,
		placeHolder: 'Choose what to bring over. Your current settings are backed up first.',
		canPickMany: true,
		ignoreFocusOut: true,
	});
	if (!chosen?.length) {
		return;
	}
	const ids = new Set(chosen.map(i => i.id));
	await vscode.window.withProgress(
		{ location: vscode.ProgressLocation.Notification, title: `Importing from ${source.product.name}`, cancellable: true },
		(progress, token) => doImport(context, source, content, ids, progress, token),
	);
}

interface Report {
	lines: string[];
	summary: string[];
	notFound: string[];
	noGallery?: boolean;
	backup?: vscode.Uri;
}

async function doImport(context: vscode.ExtensionContext, source: Source, content: SourceContent, ids: Set<ItemId>, progress: vscode.Progress<{ message?: string; increment?: number }>, token: vscode.CancellationToken) {
	const user = userDir(context);
	const report: Report = { lines: [`Import from ${source.product.name} (${source.userDir}) into ${user.toString(true)}`], summary: [], notFound: [] };
	const at = (...parts: string[]) => vscode.Uri.joinPath(user, ...parts);

	// 1. Work out every file to write first, so the backup holds each one as it was before anything changed.
	progress.report({ message: 'Reading your settings' });
	const writes: { rel: string[]; before?: string; after: string }[] = [];
	const settingsBefore = await readText(at('settings.json'));
	const settingsPlan = planSettings(settingsBefore, content.settings);
	if (ids.has('settings') && settingsPlan.add.length) {
		writes.push({ rel: ['settings.json'], before: settingsBefore, after: writeSettings(settingsBefore, settingsPlan.add) });
		report.summary.push(plural(settingsPlan.add.length, 'setting'));
		report.lines.push(`Settings: ${settingsPlan.add.length} added (${settingsPlan.add.map(a => a.path.join('.')).join(', ')}).`);
	}
	if (ids.has('settings')) {
		if (settingsPlan.kept.length) {
			report.lines.push(`Settings you already had in Insilode, kept: ${settingsPlan.kept.join(', ')}.`);
		}
		if (settingsPlan.skipped.length) {
			report.lines.push(`Settings not imported (Insilode's own, or telemetry, sync, experiments and update settings): ${settingsPlan.skipped.join(', ')}.`);
		}
	}
	if (ids.has('keybindings')) {
		const before = await readText(at('keybindings.json'));
		const plan = planKeybindings(before, content.keybindings);
		if (plan.add.length) {
			writes.push({ rel: ['keybindings.json'], before, after: writeKeybindings(before, plan.add) });
			report.summary.push(plural(plan.add.length, 'keyboard shortcut'));
		}
		report.lines.push(`Keyboard shortcuts: ${plan.add.length} added, ${plan.duplicates} already there${plan.kept.length ? `, ${plan.kept.length} not added because you bind the same key already (${plan.kept.map(k => `${k.key} → ${k.command}`).join(', ')})` : ''}.`);
	}
	if (ids.has('snippets')) {
		let files = 0;
		for (const s of content.snippets) {
			const before = await readText(at('snippets', s.name));
			const merged = mergeSnippets(before, s.text);
			if (merged.text !== undefined) {
				writes.push({ rel: ['snippets', s.name], before, after: merged.text });
				files++;
			}
			report.lines.push(`Snippets ${s.name}: ${merged.added} added${merged.kept ? `, ${merged.kept} kept (you have a snippet of that name)` : ''}.`);
		}
		if (files) {
			report.summary.push(plural(files, 'snippet file'));
		}
	}

	// 2. The backup: every file about to change, as it was before the import touched anything. A file that does not exist
	// yet has nothing to back up.
	const stamp = new Date().toISOString().replace(/[:.]/g, '-');
	const backedUp = new Set<string>();
	const backup = async (rel: string[], before: string | undefined) => {
		const key = rel.join('/');
		if (before === undefined || backedUp.has(key)) {
			return;
		}
		if (!report.backup) {
			report.backup = at('import-backups', stamp);
			report.lines.push(`Backup of the files before the import: ${report.backup.toString(true)}`);
		}
		backedUp.add(key);
		await writeText(vscode.Uri.joinPath(report.backup, ...rel), before);
	};
	for (const w of writes) {
		await backup(w.rel, w.before);
	}
	const themeChosen = ids.has('theme') && settingsPlan.theme.length > 0;

	progress.report({ message: 'Writing settings, shortcuts and snippets' });
	for (const w of writes) {
		await writeText(at(...w.rel), w.after);
	}

	// 3. Extensions, one at a time from the gallery (Open VSX), so the progress says which and a cancel stops between two.
	if (ids.has('extensions')) {
		await installExtensions(content.extensions, report, progress, token);
	}

	// 4. The theme last: a theme from an extension is only there once that extension is installed.
	if (themeChosen && !token.isCancellationRequested) {
		progress.report({ message: 'Applying the theme' });
		const themes = await installedThemes();
		const { apply, missing } = applicableTheme(settingsPlan.theme, (kind, id) => themes[kind].has(id.toLowerCase()));
		if (apply.length) {
			// settings.json as it was before the import (unchanged by it when settings were not chosen).
			await backup(['settings.json'], settingsBefore);
			const current = await readText(at('settings.json'));
			await writeText(at('settings.json'), writeSettings(current, apply.map(t => ({ path: [t.key], value: t.value }))));
			report.summary.push('your theme');
			report.lines.push(`Theme settings applied: ${apply.map(t => `${t.key} = ${JSON.stringify(t.value)}`).join(', ')}.`);
		}
		if (missing.length) {
			report.lines.push(`Not applied because the theme is not installed (its extension is not on Open VSX or did not install): ${missing.map(t => `${t.key} = ${JSON.stringify(t.value)}`).join(', ')}. Insilode keeps its own theme for these.`);
		}
	}

	if (token.isCancellationRequested) {
		report.lines.push('Cancelled: what is listed above was imported, the rest was not.');
	}
	for (const line of report.lines) {
		log.info(line);
	}
	if (report.backup) {
		await writeText(vscode.Uri.joinPath(report.backup, 'import-report.txt'), report.lines.join('\n') + '\n').catch(() => undefined);
	}

	const what = report.summary.length ? report.summary.join(', ') : 'nothing new (you already have all of it)';
	const missingText = report.notFound.length ? ` ${plural(report.notFound.length, 'extension')} ${report.notFound.length === 1 ? 'is' : 'are'} not on Open VSX: ${report.notFound.slice(0, 5).join(', ')}${report.notFound.length > 5 ? '…' : ''}.` : '';
	const galleryText = report.noGallery ? ' Extensions were not installed: this Insilode has no extension gallery.' : '';
	void vscode.window.showInformationMessage(`Imported from ${source.product.name}: ${what}.${missingText}${galleryText}`, 'Show Details').then(pick => {
		if (pick) {
			log.show(true);
		}
	});
}

/** A CancellationError (its name and message are both "Canceled"), as the publisher trust dialog throws on Cancel. */
function isCancelled(e: unknown): boolean {
	const err = e as { name?: unknown; message?: unknown } | undefined;
	return err?.name === 'Canceled' || err?.message === 'Canceled';
}

/** Ids of every installed extension, whichever extension host runs it (lower case). */
function installedIds(): Set<string> {
	return new Set(allExtensions().map(e => e.id.toLowerCase()));
}

function allExtensions(): readonly vscode.Extension<unknown>[] {
	try {
		// Across extension hosts: in a browser a theme runs in another host than this extension.
		return vscode.extensions.allAcrossExtensionHosts;
	} catch (e) {
		log.warn(`allAcrossExtensionHosts: ${(e as Error).message}; this host's extensions only.`);
		return vscode.extensions.all;
	}
}

async function installExtensions(list: string[], report: Report, progress: vscode.Progress<{ message?: string; increment?: number }>, token: vscode.CancellationToken) {
	const have = installedIds();
	const todo = list.filter(id => !have.has(id));
	const installed: string[] = [];
	const failed: string[] = [];
	const untrusted: string[] = [];
	const step = todo.length ? 100 / todo.length : 0;
	for (const [i, id] of todo.entries()) {
		if (token.isCancellationRequested) {
			break;
		}
		progress.report({ message: `Installing ${id} (${i + 1} of ${todo.length})`, increment: i ? step : 0 });
		try {
			await vscode.commands.executeCommand('workbench.extensions.installExtension', id);
			installed.push(id);
		} catch (e) {
			const message = (e as Error)?.message ?? String(e);
			if (isNoGallery(message)) {
				// Without a gallery (e.g. `npm run web`, which is not given one) every other install fails the same way.
				report.lines.push(`Extensions: not installed, this Insilode has no extension gallery (${message}). Run the import again in the desktop app to install them: ${todo.join(', ')}.`);
				report.noGallery = true;
				return;
			}
			if (isNotFound(message)) {
				report.notFound.push(id);
			} else if (isCancelled(e)) {
				// The editor asks whether to trust a publisher the first time one of its extensions is installed; "Cancel" there
				// skips that extension, and the import goes on with the next.
				untrusted.push(id);
			} else {
				failed.push(`${id} (${message})`);
			}
		}
	}
	if (installed.length) {
		report.summary.push(plural(installed.length, 'extension'));
		// A theme or setting from a new extension is known once the extension hosts have it.
		await extensionsSettled();
	}
	report.lines.push(`Extensions: ${installed.length} installed${installed.length ? ` (${installed.join(', ')})` : ''}, ${list.length - todo.length} already installed.`);
	if (report.notFound.length) {
		report.lines.push(`Not on Open VSX, so not installed: ${report.notFound.join(', ')}. Look for an alternative in the Extensions view, or install a .vsix you are allowed to use.`);
	}
	if (untrusted.length) {
		report.lines.push(`Not installed because you did not trust the publisher: ${untrusted.join(', ')}.`);
	}
	if (failed.length) {
		report.lines.push(`Could not install: ${failed.join(', ')}.`);
	}
}

/** Resolves when the extension list has not changed for a second (or after ten seconds). */
function extensionsSettled(): Promise<void> {
	return new Promise(resolve => {
		let quiet: ReturnType<typeof setTimeout>;
		const done = () => {
			clearTimeout(quiet);
			clearTimeout(cap);
			sub.dispose();
			resolve();
		};
		const sub = vscode.extensions.onDidChange(() => {
			clearTimeout(quiet);
			quiet = setTimeout(done, 1000);
		});
		quiet = setTimeout(done, 3000);
		const cap = setTimeout(done, 10000);
	});
}

interface ThemeContribution {
	id?: string;
	label?: string;
}

/** The colour, file icon and product icon themes installed now, by the id a setting names them with (lower case). */
async function installedThemes(): Promise<Record<ThemeKind, Set<string>>> {
	const out: Record<ThemeKind, Set<string>> = { color: new Set(), icon: new Set(), product: new Set() };
	for (const e of allExtensions()) {
		const c = (e.packageJSON as { contributes?: Record<string, ThemeContribution[] | undefined> })?.contributes ?? {};
		const add = (set: Set<string>, list: ThemeContribution[] | undefined, withLabel: boolean) => {
			for (const t of Array.isArray(list) ? list : []) {
				if (typeof t.id === 'string') {
					set.add(t.id.toLowerCase());
				}
				// A colour theme without an id is named by its label.
				if (withLabel && typeof t.label === 'string' && !t.label.startsWith('%')) {
					set.add(t.label.toLowerCase());
				}
			}
		};
		add(out.color, c.themes, true);
		add(out.icon, c.iconThemes, false);
		add(out.product, c.productIconThemes, false);
	}
	log.info(`Installed themes: ${out.color.size} colour, ${out.icon.size} file icon, ${out.product.size} product icon (from ${allExtensions().length} extensions).`);
	return out;
}
