/*---------------------------------------------------------------------------------------------
 *  Where another editor keeps what a user would bring along: its User folder (settings.json, keybindings.json,
 *  snippets/) and the list of extensions it has installed. Read only: nothing here writes, and an extension is known
 *  by its id alone (its files are never read or copied; Insilode installs it again from its own gallery).
 *
 *  No `vscode`: the host passes the platform, home and environment, so tests run every OS's layout on any machine.
 *--------------------------------------------------------------------------------------------*/

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { parse } from 'jsonc-parser';

export type Platform = 'win32' | 'darwin' | 'linux';

export interface Env {
	platform: Platform;
	home: string;
	/** %APPDATA% on Windows. */
	appData?: string;
	/** $XDG_CONFIG_HOME on Linux. */
	xdgConfigHome?: string;
}

export interface Product {
	id: 'code' | 'insiders' | 'cursor';
	name: string;
	/** The folder under the OS's application-data folder that holds `User`. */
	dataFolder: string;
	/** The folder under the home folder that holds `extensions`. */
	extensionsFolder: string;
}

/** In the order they are offered: VS Code first, since most people switch from it. */
export const PRODUCTS: readonly Product[] = [
	{ id: 'code', name: 'VS Code', dataFolder: 'Code', extensionsFolder: '.vscode' },
	{ id: 'insiders', name: 'VS Code Insiders', dataFolder: 'Code - Insiders', extensionsFolder: '.vscode-insiders' },
	{ id: 'cursor', name: 'Cursor', dataFolder: 'Cursor', extensionsFolder: '.cursor' },
];

export interface Source {
	product: Product;
	/** The editor's User folder (may not exist when only its extensions folder does). */
	userDir: string;
	/** The editor's extensions folder (may not exist). */
	extensionsDir: string;
}

/** The folder each OS keeps application data in, the parent of `Code/User`. */
export function appDataRoot(env: Env): string {
	switch (env.platform) {
		case 'win32': return env.appData || join(env.home, 'AppData', 'Roaming');
		case 'darwin': return join(env.home, 'Library', 'Application Support');
		default: return env.xdgConfigHome || join(env.home, '.config');
	}
}

/** The editors installed for this user: those with a User folder or an extensions folder. */
export function findSources(env: Env): Source[] {
	const root = appDataRoot(env);
	return PRODUCTS.map(product => ({
		product,
		userDir: join(root, product.dataFolder, 'User'),
		extensionsDir: join(env.home, product.extensionsFolder, 'extensions'),
	})).filter(s => isDir(s.userDir) || isDir(s.extensionsDir));
}

export interface Snippet {
	/** The file name, e.g. `typescript.json` or `react.code-snippets`. */
	name: string;
	text: string;
}

export interface SourceContent {
	settings?: string;
	keybindings?: string;
	snippets: Snippet[];
	/** Extension ids (`publisher.name`, lower case), sorted. */
	extensions: string[];
}

/** Everything that can be imported from one source, as text (settings and keybindings are JSON with comments). */
export function readSource(source: Source): SourceContent {
	const snippetsDir = join(source.userDir, 'snippets');
	const snippets = isDir(snippetsDir)
		? readdirSync(snippetsDir)
			.filter(name => /\.(json|code-snippets)$/i.test(name) && isFile(join(snippetsDir, name)))
			.sort()
			.map(name => ({ name, text: readFileSync(join(snippetsDir, name), 'utf8') }))
		: [];
	return {
		settings: readText(join(source.userDir, 'settings.json')),
		keybindings: readText(join(source.userDir, 'keybindings.json')),
		snippets,
		extensions: listExtensions(source.extensionsDir),
	};
}

/** Ids that are Insilode's own (they ship with it) and are never installed from a gallery. */
const OWN = /^flow\./;
const FOLDER = /^([a-z0-9][a-z0-9-]*\.[a-z0-9][a-z0-9._-]*?)-\d+\.\d+\.\d+/i;

interface ExtensionEntry {
	identifier?: { id?: unknown };
	relativeLocation?: unknown;
	location?: { path?: unknown; fsPath?: unknown } | string;
}

/**
 * The extensions installed in a VS Code style extensions folder. `extensions.json` is the editor's own list; folders
 * listed in `.obsolete` are uninstalled ones that are not deleted yet. Without the list (old installs), the folder names
 * (`publisher.name-1.2.3`) are the list. The same id at several versions counts once.
 */
export function listExtensions(dir: string): string[] {
	if (!isDir(dir)) {
		return [];
	}
	const obsolete = new Set(Object.keys(asObject(parse(readText(join(dir, '.obsolete')) ?? '{}'))).map(k => k.toLowerCase()));
	const ids = new Set<string>();
	const list = parse(readText(join(dir, 'extensions.json')) ?? 'null') as unknown;
	if (Array.isArray(list)) {
		for (const e of list as ExtensionEntry[]) {
			const id = typeof e?.identifier?.id === 'string' ? e.identifier.id.toLowerCase() : undefined;
			if (!id || obsolete.has(folderOf(e))) {
				continue;
			}
			ids.add(id);
		}
	} else {
		for (const name of readdirSync(dir)) {
			const m = FOLDER.exec(name);
			if (m && !obsolete.has(name.toLowerCase()) && isDir(join(dir, name))) {
				ids.add(m[1].toLowerCase());
			}
		}
	}
	return [...ids].filter(id => !OWN.test(id)).sort();
}

/** The folder an `extensions.json` entry lives in, as `.obsolete` names it. */
function folderOf(e: ExtensionEntry): string {
	if (typeof e.relativeLocation === 'string') {
		return e.relativeLocation.toLowerCase();
	}
	const loc = typeof e.location === 'string' ? e.location : (e.location?.path ?? e.location?.fsPath);
	return typeof loc === 'string' ? (loc.split(/[\\/]/).filter(Boolean).pop() ?? '').toLowerCase() : '';
}

function asObject(v: unknown): Record<string, unknown> {
	return v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : {};
}

function readText(path: string): string | undefined {
	try {
		return readFileSync(path, 'utf8');
	} catch {
		return undefined;
	}
}

function isDir(path: string): boolean {
	try {
		return statSync(path).isDirectory();
	} catch {
		return false;
	}
}

function isFile(path: string): boolean {
	try {
		return statSync(path).isFile();
	} catch {
		return false;
	}
}

