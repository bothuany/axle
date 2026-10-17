/*---------------------------------------------------------------------------------------------
 *  Axle Harness: every MCP server Claude Code and Codex would load for this folder, read from the
 *  files they read, with where each one comes from, whether it is on, and what would win when two
 *  places define the same name.
 *
 *  Claude Code (https://code.claude.com/docs/en/mcp, /settings, /managed-mcp):
 *  - user scope: `mcpServers` at the top of ~/.claude.json; local scope: `projects["<path>"].mcpServers`
 *    there. With CLAUDE_CONFIG_DIR set the file is $CLAUDE_CONFIG_DIR/.claude.json (checked with
 *    `claude mcp add --scope user` against a scratch folder), and project keys are the folder with
 *    forward slashes ("C:/dev/app").
 *  - project scope: `mcpServers` in .mcp.json at the folder's root. A server there loads only once
 *    approved: `enableAllProjectMcpServers` or `enabledMcpjsonServers` in any settings file (or in the
 *    project's entry of ~/.claude.json, where the approval prompt writes it); `disabledMcpjsonServers`
 *    anywhere rejects it.
 *  - `/mcp` turns user and local servers off per project with `projects[...].disabledMcpServers`.
 *  - precedence: local, then project, then user, then plugin servers; fields are not merged.
 *  - plugins bring servers in `.mcp.json` at the plugin root or `mcpServers` in plugin.json; their
 *    tools are named mcp__plugin_<plugin>_<server>__<tool>. Installed plugins are listed in
 *    plugins/installed_plugins.json, and the ones synced from claude.ai sit under plugins/synced.
 *  - managed-mcp.json at a system path takes exclusive control.
 *  - a JSON entry with a `url` and no `type` is a configuration error: no `type` means stdio.
 *
 *  Codex (https://learn.chatgpt.com/docs/extend/mcp?surface=cli): `[mcp_servers.<name>]` tables in
 *  $CODEX_HOME/config.toml (default ~/.codex), and in .codex/config.toml of a trusted project.
 *  stdio servers have command, args, env, env_vars, cwd; streamable HTTP ones url,
 *  bearer_token_env_var, http_headers, env_http_headers; `enabled = false` turns one off. Profile files
 *  ($CODEX_HOME/<name>.config.toml, read with `codex -p <name>`) and `[profiles.<name>]` tables are
 *  listed too, read only: they apply only to runs started with that profile.
 *
 *  Values of `env`, `headers` and `http_headers` are secrets as far as Axle is concerned: they are kept
 *  here for the status check and for edits, and `publicView` is the only shape that leaves this module
 *  for the page: names, and for each value only whether it is set and which variable it reads.
 *
 *  Pure (no vscode), so it is tested on its own.
 *--------------------------------------------------------------------------------------------*/

import * as path from 'path';
import { parse as parseJsonc, type ParseError } from 'jsonc-parser';
import { parseToml } from './mcptoml';

export type McpHarness = 'Claude' | 'Codex';
export type McpScope = 'user' | 'local' | 'project' | 'plugin' | 'managed' | 'profile';
export type Transport = 'stdio' | 'http' | 'sse' | 'ws' | 'unknown';
export type McpState = 'on' | 'off' | 'pending';

export interface McpServer {
	/** Stable for one read: harness, scope, file and name. */
	id: string;
	harness: McpHarness;
	name: string;
	scope: McpScope;
	/** The config file it is written in. */
	file: string;
	/** Where in that file: a JSON path, or the TOML table path. */
	keyPath: string[];
	format: 'json' | 'toml';
	transport: Transport;
	command?: string;
	args: string[];
	url?: string;
	cwd?: string;
	/** Values stay in the extension host: see publicView. */
	env: Record<string, string>;
	headers: Record<string, string>;
	/** Codex: variables passed through from Axle's own environment, and headers read from variables. */
	envVars: string[];
	envHeaders: Record<string, string>;
	bearerEnv?: string;
	state: McpState;
	/** Why it is on, off or waiting, in a sentence. */
	stateWhy: string;
	/** Set when Axle must not change it here (a plugin's, the organization's, Axle's own profile), with why. */
	readOnly?: string;
	/** The id of the definition that wins over this one. */
	shadowedBy?: string;
	/** The name the agent's tool calls carry (`mcp__<this>__tool`), for the usage counts. */
	toolPrefix: string;
	/** Problems a reader of the file should know about. */
	issues: { severity: 'error' | 'warning' | 'info'; message: string }[];
	/** The entry as written, for edits that must keep the keys Axle does not show. */
	raw: Record<string, unknown>;
	profile?: string;
	plugin?: string;
}

export interface McpReadInput {
	root: string;
	home: string;
	platform: NodeJS.Platform;
	claudeDir: string;
	codexDir: string;
	/** CLAUDE_CONFIG_DIR as set, or undefined: it decides where .claude.json lives. */
	claudeConfigDir?: string;
	read: (file: string) => Promise<string | undefined>;
	/** Entry names in a folder, empty when it does not exist. */
	list: (dir: string) => Promise<string[]>;
}

export interface McpConfig {
	servers: McpServer[];
	/** Files that exist but could not be read as config. */
	problems: { file: string; message: string }[];
	files: { claudeJson: string; mcpJson: string; codexUser: string; codexProject: string; settings: { user: string; project: string; local: string }; managed: string };
	/** The key of this folder in .claude.json's `projects`, as written there (or as Claude Code would write it). */
	projectKey: string;
}

const isObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const strings = (v: unknown) => Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
const stringMap = (v: unknown): Record<string, string> => isObject(v) ? Object.fromEntries(Object.entries(v).filter(([, x]) => typeof x === 'string' || typeof x === 'number' || typeof x === 'boolean').map(([k, x]) => [k, String(x)])) : {};

/** Where Claude Code keeps .claude.json: in CLAUDE_CONFIG_DIR when that is set, else in the home folder. */
export const claudeJsonPath = (home: string, claudeConfigDir?: string) => claudeConfigDir ? path.join(claudeConfigDir, '.claude.json') : path.join(home, '.claude.json');

/** managed-mcp.json's system path (https://code.claude.com/docs/en/managed-mcp). */
export function managedMcpPath(platform: NodeJS.Platform): string {
	return platform === 'win32' ? 'C:\\Program Files\\ClaudeCode\\managed-mcp.json'
		: platform === 'darwin' ? '/Library/Application Support/ClaudeCode/managed-mcp.json'
			: '/etc/claude-code/managed-mcp.json';
}

/** Tool names carry the server's name with every character outside A-Z, a-z, 0-9, `_` and `-` as `_`. */
export const toolPrefixOf = (name: string) => name.replace(/[^\w-]/g, '_');

/** A folder as Claude Code spells it in `projects`: forward slashes, and (on Windows) an upper-case drive letter, as process.cwd() gives it. */
export function claudeProjectKey(root: string, platform: NodeJS.Platform): string {
	const slashed = platform === 'win32' ? root.replace(/\\/g, '/') : root;
	return platform === 'win32' ? slashed.replace(/^([a-z]):/, (_, d: string) => `${d.toUpperCase()}:`) : slashed;
}

/** The key of `root` among `projects`' keys: Windows paths compare without case and with either slash. */
export function findProjectKey(keys: string[], root: string, platform: NodeJS.Platform): string | undefined {
	const norm = (p: string) => {
		const s = platform === 'win32' ? p.replace(/\\/g, '/').toLowerCase() : p;
		return s.length > 1 ? s.replace(/\/+$/, '') : s;
	};
	const want = norm(root);
	return keys.find(k => norm(k) === want);
}

export function parseJson(text: string): { value: unknown; error?: string } {
	const errors: ParseError[] = [];
	const value = parseJsonc(text, errors, { allowTrailingComma: true, disallowComments: false });
	return { value, error: errors.length ? `JSON error at offset ${errors[0].offset}` : undefined };
}

function transportOf(raw: Record<string, unknown>, harness: McpHarness): Transport {
	if (harness === 'Codex') {
		return typeof raw.url === 'string' ? 'http' : typeof raw.command === 'string' ? 'stdio' : 'unknown';
	}
	const t = typeof raw.type === 'string' ? raw.type.toLowerCase() : undefined;
	if (!t) {
		return 'stdio';
	}
	return t === 'streamable-http' ? 'http' : t === 'stdio' || t === 'http' || t === 'sse' || t === 'ws' ? t : 'unknown';
}

interface Base { harness: McpHarness; scope: McpScope; file: string; keyPath: string[]; format: 'json' | 'toml'; readOnly?: string; profile?: string; plugin?: string; displayName?: string; toolPrefix?: string }

function server(name: string, raw: Record<string, unknown>, b: Base): McpServer {
	const transport = transportOf(raw, b.harness);
	const display = b.displayName ?? name;
	const s: McpServer = {
		id: [b.harness, b.scope, b.profile ?? b.plugin ?? '', b.file, display].join('|'),
		harness: b.harness, name: display, scope: b.scope, file: b.file, keyPath: [...b.keyPath, name], format: b.format,
		transport,
		command: typeof raw.command === 'string' ? raw.command : undefined,
		args: strings(raw.args),
		url: typeof raw.url === 'string' ? raw.url : undefined,
		cwd: typeof raw.cwd === 'string' ? raw.cwd : undefined,
		env: stringMap(raw.env),
		headers: stringMap(b.harness === 'Codex' ? raw.http_headers : raw.headers),
		envVars: strings(raw.env_vars),
		envHeaders: stringMap(raw.env_http_headers),
		bearerEnv: typeof raw.bearer_token_env_var === 'string' ? raw.bearer_token_env_var : undefined,
		state: 'on', stateWhy: 'On',
		readOnly: b.readOnly,
		toolPrefix: b.toolPrefix ?? toolPrefixOf(name),
		issues: [], raw, profile: b.profile, plugin: b.plugin,
	};
	if (b.harness === 'Claude' && !raw.type && typeof raw.url === 'string') {
		s.issues.push({ severity: 'error', message: 'Has a "url" but no "type": Claude Code reads it as a stdio server and fails. Add "type": "http"' });
	}
	if (transport === 'unknown') {
		s.issues.push({ severity: 'error', message: b.harness === 'Codex' ? 'Neither "command" nor "url": Codex cannot start it' : `Unknown type "${String(raw.type)}"` });
	}
	if (transport === 'sse') {
		s.issues.push({ severity: 'info', message: 'SSE is deprecated in Claude Code: use "type": "http" if the server supports it' });
	}
	const literal = [...Object.entries(s.env), ...Object.entries(s.headers)].filter(([, v]) => v && !/\$\{[^}]+\}/.test(v) && looksSecret(v));
	if (literal.length && b.scope === 'project') {
		s.issues.push({ severity: 'warning', message: `${literal.map(([k]) => k).join(', ')} ${literal.length === 1 ? 'holds' : 'hold'} a literal secret in a shared file: use \${VAR} to read it from the environment` });
	}
	// A plugin's or the organization's server cannot be fixed here: what is wrong with it is worth knowing, not a mark against this harness.
	if (b.readOnly) {
		s.issues.forEach(i => i.severity = 'info');
	}
	return s;
}

/** A value that is probably a credential rather than a setting: long, no spaces, mixed letters and digits. */
export function looksSecret(v: string): boolean {
	return /^(sk-|ghp_|gho_|github_pat_|xox[abps]-|AKIA|glpat-|Bearer\s)/.test(v) || (v.length >= 20 && !/\s/.test(v) && /\d/.test(v) && /[A-Za-z]/.test(v) && !/^[./\\~]|:\/\//.test(v));
}

function serversIn(obj: unknown, b: Base): McpServer[] {
	return isObject(obj) ? Object.entries(obj).filter(([, v]) => isObject(v)).map(([n, v]) => server(n, v as Record<string, unknown>, b)) : [];
}

export async function readMcp(input: McpReadInput): Promise<McpConfig> {
	const { root, platform } = input;
	const problems: McpConfig['problems'] = [];
	const servers: McpServer[] = [];
	const claudeJson = claudeJsonPath(input.home, input.claudeConfigDir);
	const files: McpConfig['files'] = {
		claudeJson,
		mcpJson: path.join(root, '.mcp.json'),
		codexUser: path.join(input.codexDir, 'config.toml'),
		codexProject: path.join(root, '.codex', 'config.toml'),
		settings: { user: path.join(input.claudeDir, 'settings.json'), project: path.join(root, '.claude', 'settings.json'), local: path.join(root, '.claude', 'settings.local.json') },
		managed: managedMcpPath(platform),
	};
	// Files Claude Code reads as strict JSON: a comment or a trailing comma makes it reject the whole file (`claude mcp add`
	// says ".mcp.json is malformed"), so the servers in it are listed, but as off.
	const nonStrict = new Set<string>();
	const json = async (file: string, strict = false): Promise<Record<string, unknown> | undefined> => {
		const text = await input.read(file);
		if (text === undefined || !text.trim()) {
			return undefined;
		}
		const { value, error } = parseJson(text);
		if (error || !isObject(value)) {
			problems.push({ file, message: error ?? 'Not a JSON object' });
			return isObject(value) ? value : undefined;
		}
		if (strict) {
			try {
				JSON.parse(text);
			} catch {
				nonStrict.add(file);
				problems.push({ file, message: 'Not strict JSON (a comment or a trailing comma): Claude Code rejects the file and loads none of its servers' });
			}
		}
		return value;
	};

	// ---- Claude Code
	const cj = await json(claudeJson, true) ?? {};
	const projects = isObject(cj.projects) ? cj.projects : {};
	const projectKey = findProjectKey(Object.keys(projects), root, platform) ?? claudeProjectKey(root, platform);
	const proj = isObject(projects[projectKey]) ? projects[projectKey] as Record<string, unknown> : {};
	const settings = { user: await json(files.settings.user), project: await json(files.settings.project), local: await json(files.settings.local) };
	const managed = await json(files.managed, true);

	const claude: McpServer[] = [];
	if (managed) {
		claude.push(...serversIn(managed.mcpServers, { harness: 'Claude', scope: 'managed', file: files.managed, keyPath: ['mcpServers'], format: 'json', readOnly: 'Deployed by your organization (managed-mcp.json)' }));
	}
	// Claude Code keys a folder by its working directory exactly as it was started there, so on Windows "C:/a" and "c:/a"
	// can both exist (a terminal and an editor spell the drive differently); each one's servers are this folder's.
	for (const key of [projectKey, ...Object.keys(projects).filter(k => k !== projectKey && findProjectKey([k], root, platform))]) {
		const entry = isObject(projects[key]) ? projects[key] as Record<string, unknown> : {};
		const found = serversIn(entry.mcpServers, { harness: 'Claude', scope: 'local', file: claudeJson, keyPath: ['projects', key, 'mcpServers'], format: 'json' });
		if (key !== projectKey) {
			found.forEach(s => s.issues.push({ severity: 'info', message: `Written under "${key}": Claude Code sees it only when started from the folder spelled that way` }));
		}
		claude.push(...found.filter(f => !claude.some(c => c.scope === 'local' && c.name === f.name)));
	}
	const mcpJson = await json(files.mcpJson, true);
	claude.push(...serversIn(mcpJson?.mcpServers, { harness: 'Claude', scope: 'project', file: files.mcpJson, keyPath: ['mcpServers'], format: 'json' }));
	claude.push(...serversIn(cj.mcpServers, { harness: 'Claude', scope: 'user', file: claudeJson, keyPath: ['mcpServers'], format: 'json' }));
	claude.push(...await pluginServers(input, settings, problems));

	// Approval of .mcp.json servers, and the /mcp switches for user and local ones.
	const lists = [
		{ where: '.claude/settings.local.json', s: settings.local }, { where: '.claude/settings.json', s: settings.project },
		{ where: '~/.claude/settings.json', s: settings.user }, { where: 'this folder in .claude.json', s: proj },
	];
	const disabledByMcp = new Set(strings(proj.disabledMcpServers));
	for (const s of claude) {
		if (s.scope === 'project') {
			const rejected = lists.find(l => strings(l.s?.disabledMcpjsonServers).includes(s.name));
			const approved = lists.find(l => strings(l.s?.enabledMcpjsonServers).includes(s.name));
			const all = lists.find(l => l.s?.enableAllProjectMcpServers === true);
			if (rejected) {
				[s.state, s.stateWhy] = ['off', `Rejected in ${rejected.where} (disabledMcpjsonServers)`];
			} else if (approved || all) {
				[s.state, s.stateWhy] = ['on', approved ? `Approved in ${approved.where} (enabledMcpjsonServers)` : `All project servers approved in ${all!.where}`];
			} else {
				[s.state, s.stateWhy] = ['pending', 'Not approved yet: Claude Code asks at the next session start'];
			}
		} else if ((s.scope === 'user' || s.scope === 'local') && disabledByMcp.has(s.name)) {
			[s.state, s.stateWhy] = ['off', 'Turned off for this folder (disabledMcpServers, as /mcp writes it)'];
		}
	}
	// One definition per name: local, project, user, plugin (managed-mcp.json, when there is one, replaces all of them).
	const rank: Record<McpScope, number> = { managed: 0, local: 1, project: 2, user: 3, plugin: 4, profile: 5 };
	const winner = new Map<string, McpServer>();
	for (const s of [...claude].sort((a, b) => rank[a.scope] - rank[b.scope])) {
		const w = winner.get(s.name);
		if (w) {
			s.shadowedBy = w.id;
			s.issues.push({ severity: 'info', message: `Not used: the ${w.scope} definition of "${s.name}" wins (fields are not merged)` });
		} else {
			winner.set(s.name, s);
		}
	}
	for (const s of claude.filter(x => nonStrict.has(x.file))) {
		[s.state, s.stateWhy] = ['off', `${path.basename(s.file)} is not strict JSON, so Claude Code rejects the whole file`];
	}
	if (managed) {
		for (const s of claude.filter(x => x.scope !== 'managed')) {
			[s.state, s.stateWhy] = ['off', 'managed-mcp.json is deployed: Claude Code loads only the servers it lists'];
		}
	}
	servers.push(...claude);

	// ---- Codex
	const codex: McpServer[] = [];
	const toml = async (file: string, scope: McpScope, readOnly?: string, profile?: string) => {
		const text = await input.read(file);
		if (text === undefined) {
			return;
		}
		const doc = parseToml(text);
		if (doc.error) {
			problems.push({ file, message: doc.error });
			return;
		}
		codex.push(...serversIn(doc.data.mcp_servers, { harness: 'Codex', scope, file, keyPath: ['mcp_servers'], format: 'toml', readOnly, profile }));
		for (const [p, body] of Object.entries(isObject(doc.data.profiles) ? doc.data.profiles : {})) {
			if (isObject(body)) {
				codex.push(...serversIn(body.mcp_servers, { harness: 'Codex', scope: 'profile', file, keyPath: ['profiles', p, 'mcp_servers'], format: 'toml', profile: p, readOnly: `Only with \`codex -p ${p}\`: edit it in the file` }));
			}
		}
	};
	await toml(files.codexProject, 'project');
	await toml(files.codexUser, 'user');
	for (const n of (await input.list(input.codexDir)).filter(n => /^[\w.-]+\.config\.toml$/.test(n)).sort()) {
		const p = n.replace(/\.config\.toml$/, '');
		// Axle's own profile must stay byte-for-byte the same (Codex trusts its hooks by hash): never edited here.
		await toml(path.join(input.codexDir, n), 'profile', p === 'axle' ? "Axle's own Codex profile: Axle writes it" : `Only with \`codex -p ${p}\`: edit it in the file`, p);
	}
	for (const s of codex) {
		if (s.raw.enabled === false) {
			[s.state, s.stateWhy] = ['off', 'enabled = false'];
		} else if (s.scope === 'profile') {
			[s.state, s.stateWhy] = ['on', `Only in runs started with -p ${s.profile}`];
		} else if (s.scope === 'project') {
			s.stateWhy = 'On when Codex trusts this project';
		}
	}
	const codexWinner = new Map<string, McpServer>();
	for (const s of codex.filter(x => x.scope !== 'profile')) {
		const w = codexWinner.get(s.name);
		if (w) {
			s.shadowedBy = w.id;
			s.issues.push({ severity: 'info', message: `Not used in this project: .codex/config.toml defines "${s.name}" too` });
		} else {
			codexWinner.set(s.name, s);
		}
	}
	servers.push(...codex);
	return { servers, problems, files, projectKey };
}

/** Servers that enabled plugins bring: read only, since installing or removing the plugin is what adds or removes them. */
async function pluginServers(input: McpReadInput, settings: Record<string, Record<string, unknown> | undefined>, problems: McpConfig['problems']): Promise<McpServer[]> {
	const out: McpServer[] = [];
	const enabled: Record<string, unknown> = {};
	for (const s of [settings.user, settings.project, settings.local]) {
		Object.assign(enabled, isObject(s?.enabledPlugins) ? s.enabledPlugins : {});
	}
	const dirs: { dir: string; id?: string }[] = [];
	const record = await input.read(path.join(input.claudeDir, 'plugins', 'installed_plugins.json'));
	if (record) {
		const { value } = parseJson(record);
		const plugins = isObject(value) && isObject(value.plugins) ? value.plugins : {};
		for (const [id, installs] of Object.entries(plugins)) {
			for (const inst of Array.isArray(installs) ? installs.filter(isObject) : []) {
				const forHere = typeof inst.projectPath !== 'string' || findProjectKey([inst.projectPath], input.root, input.platform);
				if (typeof inst.installPath === 'string' && forHere) {
					dirs.push({ dir: inst.installPath, id });
				}
			}
		}
	}
	// Plugins synced from the claude.ai account: plugins/synced/<account>/<plugin>.
	const synced = path.join(input.claudeDir, 'plugins', 'synced');
	for (const account of await input.list(synced)) {
		for (const p of await input.list(path.join(synced, account))) {
			dirs.push({ dir: path.join(synced, account, p) });
		}
	}
	for (const { dir, id } of dirs) {
		const manifestText = await input.read(path.join(dir, '.claude-plugin', 'plugin.json'));
		const manifest = manifestText ? parseJson(manifestText).value : undefined;
		const name = isObject(manifest) && typeof manifest.name === 'string' ? manifest.name : (id?.split('@')[0] ?? path.basename(dir).replace(/~.*$/, ''));
		const key = id ?? Object.keys(enabled).find(k => k.split('@')[0] === name);
		if (key && enabled[key] === false) {
			continue;
		}
		let file = path.join(dir, '.mcp.json');
		let defs: unknown;
		let keyPath = ['mcpServers'];
		const inline = isObject(manifest) ? manifest.mcpServers : undefined;
		if (isObject(inline)) {
			[file, defs, keyPath] = [path.join(dir, '.claude-plugin', 'plugin.json'), inline, ['mcpServers']];
		} else {
			if (typeof inline === 'string') {
				file = path.resolve(dir, inline);
			}
			const text = await input.read(file);
			if (text === undefined) {
				continue;
			}
			const { value, error } = parseJson(text);
			if (error) {
				problems.push({ file, message: error });
				continue;
			}
			// A plugin's .mcp.json may hold the servers under mcpServers or at the top.
			[defs, keyPath] = isObject(value) && isObject(value.mcpServers) ? [value.mcpServers, ['mcpServers']] : [value, []];
		}
		for (const [n, def] of Object.entries(isObject(defs) ? defs : {})) {
			if (isObject(def)) {
				out.push(server(n, def, {
					harness: 'Claude', scope: 'plugin', file, keyPath, format: 'json', plugin: name,
					displayName: `plugin:${name}:${n}`, toolPrefix: toolPrefixOf(`plugin_${name}_${n}`),
					readOnly: `From the ${name} plugin: install or remove the plugin to change it`,
				}));
			}
		}
	}
	return out;
}

// ---------------------------------------------------------------------------------------------
// What the page may see

export interface EnvView {
	name: string;
	/** "${API_KEY}" reads API_KEY from the environment: naming the variable gives nothing away. */
	from?: string;
	/** A literal value is there (never which). */
	set: boolean;
}

export interface McpView {
	id: string;
	harness: McpHarness;
	name: string;
	scope: McpScope;
	file: string;
	transport: Transport;
	command?: string;
	args: string[];
	url?: string;
	cwd?: string;
	env: EnvView[];
	headers: EnvView[];
	envVars: string[];
	bearerEnv?: string;
	state: McpState;
	stateWhy: string;
	readOnly?: string;
	shadowed: boolean;
	issues: McpServer['issues'];
	profile?: string;
	plugin?: string;
}

const MASK = '••••';

function envView(map: Record<string, string>): EnvView[] {
	return Object.entries(map).map(([name, v]) => {
		const ref = /^\$\{([A-Za-z_][\w]*)(?::-[^}]*)?\}$/.exec(v.trim())?.[1] ?? /^\$([A-Za-z_]\w*)$/.exec(v.trim())?.[1];
		return { name, from: ref, set: !!v && !ref };
	});
}

/** An argument list with what looks like a credential hidden: the value after --token/--api-key/…, `--key=value`, and anything shaped like a key. */
export function maskArgs(args: string[]): string[] {
	const flag = /^--?[\w-]*(key|token|secret|password|passwd|auth|credential|pat)[\w-]*$/i;
	return args.map((a, n) => {
		const eq = /^(--?[\w-]*(?:key|token|secret|password|passwd|auth|credential|pat)[\w-]*=)(.+)$/i.exec(a);
		if (eq) {
			return eq[1] + MASK;
		}
		if (n > 0 && flag.test(args[n - 1]) && !a.startsWith('-')) {
			return MASK;
		}
		return looksSecret(a) && !/[/\\]/.test(a) ? MASK : a;
	});
}

/** A URL with its password and secret-looking query values hidden. */
export function maskUrl(url: string): string {
	try {
		const u = new URL(url);
		if (u.password) {
			u.password = 'x';
		}
		for (const [k, v] of u.searchParams) {
			if (/key|token|secret|auth|sig|password|code/i.test(k) || looksSecret(v)) {
				u.searchParams.set(k, 'x');
			}
		}
		return u.toString().replace(/:x@/, `:${MASK}@`).replace(/=x(?=&|$)/g, `=${MASK}`);
	} catch {
		return url;
	}
}

export function publicView(s: McpServer): McpView {
	return {
		id: s.id, harness: s.harness, name: s.name, scope: s.scope, file: s.file, transport: s.transport,
		command: s.command, args: maskArgs(s.args), url: s.url && maskUrl(s.url), cwd: s.cwd,
		env: envView(s.env), headers: [...envView(s.headers), ...Object.entries(s.envHeaders).map(([name, v]) => ({ name, from: v, set: false }))],
		envVars: s.envVars, bearerEnv: s.bearerEnv,
		state: s.state, stateWhy: s.stateWhy, readOnly: s.readOnly, shadowed: !!s.shadowedBy, issues: s.issues, profile: s.profile, plugin: s.plugin,
	};
}

/** Every literal secret value in a set of servers, for hiding them in previews and messages. */
export function secretsOf(servers: (Pick<McpServer, 'env' | 'headers' | 'args'> & { url?: string })[]): string[] {
	const out = new Set<string>();
	for (const s of servers) {
		for (const v of [...Object.values(s.env), ...Object.values(s.headers)]) {
			if (v && !/^\$\{[^}]+\}$/.test(v.trim())) {
				out.add(v);
			}
		}
		maskArgs(s.args).forEach((m, n) => m !== s.args[n] && out.add(s.args[n].replace(/^--?[\w-]+=/, '')));
		// What maskUrl hides in a URL: its password and secret-looking query values.
		try {
			const u = new URL(s.url ?? '');
			if (u.password) {
				out.add(decodeURIComponent(u.password));
				out.add(u.password);
			}
			for (const [k, v] of u.searchParams) {
				if (v && (/key|token|secret|auth|sig|password|code/i.test(k) || looksSecret(v))) {
					out.add(v);
					out.add(encodeURIComponent(v));
				}
			}
		} catch {
			// not a URL
		}
	}
	return [...out].filter(v => v.length >= 1);
}

/** `text` with each secret hidden wherever it appears quoted (JSON or TOML), or after `=`/`Bearer ` in a command line. */
export function maskText(text: string, secrets: string[]): string {
	let out = text;
	const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
	for (const v of [...secrets].sort((a, b) => b.length - a.length)) {
		// A quoted value, but not a key ("A": …, A = …) that happens to be spelled the same.
		for (const quoted of new Set([JSON.stringify(v), `'${v}'`])) {
			out = out.replace(new RegExp(`${esc(quoted)}(?!\\s*[:=])`, 'g'), `"${MASK}"`);
		}
		// Long values also hide unquoted (a command line, a header "Authorization: Bearer x"); short ones would hit ordinary words.
		if (v.length >= 6) {
			out = out.split(v).join(MASK);
		} else {
			out = out.replace(new RegExp(`(=|Bearer )${esc(v)}(?=\\s|"|'|$)`, 'g'), `$1${MASK}`);
		}
	}
	return out;
}
