// The MCP server manager's pure parts: reading and merging both agents' configs from fixtures (Windows and POSIX
// paths), what the page may see (names, never values), and the edits, which must round-trip without losing other
// keys or comments. Every fixture is synthetic; nothing reads the real ~/.claude.json or ~/.codex.
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { build } from 'esbuild'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
let cfg, edit, toml
let tmp
before(async () => {
	tmp = mkdtempSync(join(tmpdir(), 'flow-mcp-'))
	const load = async name => {
		const outfile = join(tmp, `${name}.mjs`)
		await build({ entryPoints: [join(ROOT, 'src', `${name}.ts`)], bundle: true, platform: 'node', format: 'esm', mainFields: ['module', 'main'], outfile, logLevel: 'silent' })
		return import(pathToFileURL(outfile).href)
	}
	cfg = await load('mcpconfig')
	edit = await load('mcpedit')
	toml = await load('mcptoml')
})
after(() => rmSync(tmp, { recursive: true, force: true }))

/** A read function over an in-memory folder tree; keys are compared with forward slashes. */
function fs(files) {
	const norm = p => p.replace(/\\/g, '/')
	const map = new Map(Object.entries(files).map(([k, v]) => [norm(k), v]))
	return {
		read: async f => map.get(norm(f)),
		list: async d => {
			const pre = norm(d).replace(/\/$/, '') + '/'
			return [...new Set([...map.keys()].filter(k => k.startsWith(pre)).map(k => k.slice(pre.length).split('/')[0]))]
		},
	}
}

const SECRET = 'sk-test-0123456789abcdefghij'

function windowsInput(files, extra = {}) {
	return {
		root: 'c:\\work\\app', home: 'C:\\Users\\me', platform: 'win32',
		claudeDir: 'C:\\Users\\me\\.claude', codexDir: 'C:\\Users\\me\\.codex', ...fs(files), ...extra,
	}
}

test('Claude Code on Windows: user, local (project key in another spelling), project, approval lists and precedence', async () => {
	const files = {
		'C:/Users/me/.claude.json': JSON.stringify({
			oauthAccount: { emailAddress: 'x@example.com' },
			mcpServers: { shared: { type: 'stdio', command: 'node', args: ['user.js'] }, solo: { type: 'http', url: 'https://u.example/mcp' } },
			projects: {
				'C:/work/app': {
					mcpServers: { shared: { type: 'stdio', command: 'node', args: ['local.js'], env: { API_KEY: SECRET, HOME_DIR: '${HOME}' } } },
					disabledMcpServers: ['solo'],
					enabledMcpjsonServers: ['repo'],
				},
			},
		}),
		'c:/work/app/.mcp.json': JSON.stringify({ mcpServers: { repo: { command: 'npx', args: ['-y', 'x'] }, waiting: { type: 'http', url: 'https://w.example' }, broken: { url: 'https://b.example' } } }),
		'c:/work/app/.claude/settings.local.json': JSON.stringify({ disabledMcpjsonServers: ['waiting'] }),
	}
	const c = await cfg.readMcp(windowsInput(files))
	assert.equal(c.projectKey, 'C:/work/app', 'the key as written in .claude.json, not as VS Code spells the folder')
	const by = (name, scope) => c.servers.find(s => s.name === name && s.scope === scope)
	assert.equal(by('shared', 'local').args[0], 'local.js')
	assert.ok(by('shared', 'user').shadowedBy, 'local wins over user')
	assert.equal(by('shared', 'local').shadowedBy, undefined)
	assert.equal(by('solo', 'user').state, 'off')
	assert.match(by('solo', 'user').stateWhy, /disabledMcpServers/)
	assert.equal(by('repo', 'project').state, 'on')
	assert.match(by('repo', 'project').stateWhy, /this folder in .claude.json/)
	assert.equal(by('waiting', 'project').state, 'off', 'disabledMcpjsonServers rejects it')
	assert.equal(by('broken', 'project').issues[0].severity, 'error', 'a url without a type reads as stdio')
	assert.ok(by('repo', 'project').issues.some(i => /cmd/.test(i.message)), 'npx on Windows needs cmd /c')
	assert.deepEqual(by('shared', 'local').keyPath, ['projects', 'C:/work/app', 'mcpServers', 'shared'])
})

test('CLAUDE_CONFIG_DIR moves .claude.json into it; POSIX paths and a pending project server', async () => {
	assert.equal(cfg.claudeJsonPath('/home/me', '/tmp/cc'), join('/tmp/cc', '.claude.json'))
	assert.equal(cfg.claudeJsonPath('/home/me'), join('/home/me', '.claude.json'))
	const c = await cfg.readMcp({
		root: '/home/me/app', home: '/home/me', platform: 'linux', claudeDir: '/tmp/cc', claudeConfigDir: '/tmp/cc', codexDir: '/home/me/.codex',
		...fs({
			'/tmp/cc/.claude.json': JSON.stringify({ projects: { '/home/me/app': { mcpServers: { l: { command: 'l' } } } } }),
			'/home/me/.claude.json': JSON.stringify({ mcpServers: { ignored: { command: 'x' } } }),
			'/home/me/app/.mcp.json': JSON.stringify({ mcpServers: { p: { command: 'p' } } }),
		}),
	})
	assert.deepEqual(c.servers.map(s => `${s.scope}:${s.name}`).sort(), ['local:l', 'project:p'])
	assert.equal(c.servers.find(s => s.name === 'p').state, 'pending')
	assert.equal(cfg.claudeProjectKey('c:\\work\\app', 'win32'), 'C:/work/app')
	assert.equal(cfg.findProjectKey(['C:/Work/App/'], 'c:\\work\\app', 'win32'), 'C:/Work/App/')
	assert.equal(cfg.findProjectKey(['/Home/app'], '/home/app', 'linux'), undefined, 'POSIX paths keep their case')
})

test('plugin servers are read only, named plugin:<plugin>:<server>, and skipped when the plugin is off', async () => {
	const c = await cfg.readMcp(windowsInput({
		'C:/Users/me/.claude/plugins/installed_plugins.json': JSON.stringify({ version: 2, plugins: {
			'tools@market': [{ scope: 'user', installPath: 'C:\\Users\\me\\.claude\\plugins\\cache\\tools' }],
			'off@market': [{ scope: 'user', installPath: 'C:\\Users\\me\\.claude\\plugins\\cache\\off' }],
		} }),
		'C:/Users/me/.claude/plugins/cache/tools/.mcp.json': JSON.stringify({ db: { command: '${CLAUDE_PLUGIN_ROOT}/db' } }),
		'C:/Users/me/.claude/plugins/cache/off/.mcp.json': JSON.stringify({ mcpServers: { nope: { command: 'n' } } }),
		'C:/Users/me/.claude/plugins/synced/acct/data/.claude-plugin/plugin.json': JSON.stringify({ name: 'data' }),
		'C:/Users/me/.claude/plugins/synced/acct/data/.mcp.json': JSON.stringify({ mcpServers: { hex: { type: 'http', url: 'https://hex.example/mcp' } } }),
		'C:/Users/me/.claude/settings.json': JSON.stringify({ enabledPlugins: { 'off@market': false } }),
	}))
	const names = c.servers.map(s => s.name).sort()
	assert.deepEqual(names, ['plugin:data:hex', 'plugin:tools:db'])
	const hex = c.servers.find(s => s.name === 'plugin:data:hex')
	assert.ok(hex.readOnly)
	assert.equal(hex.toolPrefix, 'plugin_data_hex', 'the name its tool calls carry, for the usage counts')
})

test('Codex: user and project config.toml, profiles read only, enabled = false, Axle profile never editable', async () => {
	const user = [
		'model = "o3"',
		'',
		'[mcp_servers.docs]',
		'command = "npx"',
		'args = ["-y", "@upstash/context7-mcp"]',
		'',
		'[mcp_servers.docs.env]',
		`TOKEN = "${SECRET}"`,
		'',
		'[mcp_servers."web.search"]',
		'url = "https://s.example/mcp"',
		'bearer_token_env_var = "S_TOKEN"',
		'enabled = false',
		'',
		'[profiles.fast.mcp_servers.quick]',
		"command = 'q'",
	].join('\n')
	const c = await cfg.readMcp(windowsInput({
		'C:/Users/me/.codex/config.toml': user,
		'C:/Users/me/.codex/axle.config.toml': '[mcp_servers.axle]\ncommand = "node"\n',
		'c:/work/app/.codex/config.toml': '[mcp_servers.docs]\ncommand = "local-docs"\n',
	}))
	const codex = c.servers.filter(s => s.harness === 'Codex')
	const docsUser = codex.find(s => s.name === 'docs' && s.scope === 'user')
	assert.equal(docsUser.env.TOKEN, SECRET)
	assert.ok(docsUser.shadowedBy, 'the project definition wins')
	const web = codex.find(s => s.name === 'web.search')
	assert.equal(web.transport, 'http')
	assert.equal(web.state, 'off')
	assert.equal(web.toolPrefix, 'web_search')
	assert.equal(web.bearerEnv, 'S_TOKEN')
	assert.ok(codex.find(s => s.name === 'quick').readOnly)
	assert.match(codex.find(s => s.name === 'axle').readOnly, /Axle/)
})

test('the page sees names and variable references, never values', async () => {
	const c = await cfg.readMcp(windowsInput({
		'C:/Users/me/.claude.json': JSON.stringify({ mcpServers: { s: { command: 'srv', args: ['--api-key', SECRET, '--token=abc123', 'plain'], env: { A: SECRET, B: '${B_FROM}' } }, h: { type: 'http', url: `https://h.example/mcp?api_key=${SECRET}&x=1`, headers: { Authorization: `Bearer ${SECRET}` } } } }),
	}))
	const views = c.servers.map(cfg.publicView)
	const text = JSON.stringify(views)
	assert.ok(!text.includes(SECRET), text)
	assert.ok(!text.includes('abc123'))
	const s = views.find(v => v.name === 's')
	assert.deepEqual(s.env, [{ name: 'A', from: undefined, set: true }, { name: 'B', from: 'B_FROM', set: false }])
	assert.deepEqual(s.args, ['--api-key', '••••', '--token=••••', 'plain'])
	assert.match(views.find(v => v.name === 'h').url, /api_key=••••&x=1/)
	assert.ok(!('raw' in s) && !('headers' in s && s.headers.some(h => 'value' in h)))
	const masked = cfg.maskText(`{"A": "${SECRET}", "${SECRET}": 1}\nclaude -e A=${SECRET}`, cfg.secretsOf(c.servers))
	assert.ok(!masked.includes(SECRET), masked)
	assert.equal(cfg.maskText('{"b": "b", "x": "b"}', ['b']), '{"b": "••••", "x": "••••"}', 'a key spelled like a short secret stays')
})

test('JSON edits keep every other key, comments and indentation', () => {
	const before = '{\n\t// mine\n\t"other": {"keep": true},\n\t"mcpServers": {\n\t\t"a": {"type": "stdio", "command": "a", "timeout": 5}\n\t}\n}\n'
	const added = edit.jsonSet(before, ['mcpServers', 'b'], edit.claudeEntry({ transport: 'http', url: 'https://b.example' }))
	assert.match(added, /\/\/ mine/)
	assert.match(added, /"keep": true/)
	assert.match(added, /\n\t\t"b": \{/, 'tabs, as the file uses')
	const changed = edit.jsonSet(added, ['mcpServers', 'a'], edit.claudeEntry({ transport: 'stdio', command: 'a2', args: ['x'] }, { type: 'stdio', command: 'a', timeout: 5 }))
	const parsed = cfg.parseJson(changed).value
	assert.deepEqual(parsed.mcpServers.a, { type: 'stdio', command: 'a2', timeout: 5, args: ['x'] }, 'timeout survives the edit')
	assert.deepEqual(parsed.other, { keep: true })
	const removed = edit.jsonSet(changed, ['mcpServers', 'a'], undefined)
	assert.deepEqual(Object.keys(cfg.parseJson(removed).value.mcpServers), ['b'])
	assert.match(removed, /\/\/ mine/)
	assert.equal(edit.jsonSet('', ['mcpServers', 'x'], { type: 'stdio', command: 'x' }).trim().startsWith('{'), true, 'a new .mcp.json')
	assert.throws(() => edit.jsonSet('{"projects": []}', ['projects', 'C:/a', 'mcpServers', 'x'], {}), /not an object/)
	// A switch to http drops the stdio keys and keeps the rest.
	assert.deepEqual(edit.claudeEntry({ transport: 'http', url: 'u' }, { type: 'stdio', command: 'c', args: [], env: {}, alwaysLoad: true }), { type: 'http', alwaysLoad: true, url: 'u' })
})

test('local scope: a new project entry in .claude.json, approval lists', () => {
	const cj = JSON.stringify({ numStartups: 3, projects: { 'C:/other': { allowedTools: [] } } }, null, 2)
	const out = edit.jsonSet(cj, ['projects', 'C:/work/app', 'mcpServers', 'x'], { type: 'stdio', command: 'x', args: [] })
	const v = cfg.parseJson(out).value
	assert.equal(v.numStartups, 3)
	assert.deepEqual(v.projects['C:/other'], { allowedTools: [] })
	assert.equal(v.projects['C:/work/app'].mcpServers.x.command, 'x')
	const listed = edit.jsonList('{"disabledMcpjsonServers": ["a"]}', ['disabledMcpjsonServers'], 'b', true)
	assert.deepEqual(cfg.parseJson(listed).value.disabledMcpjsonServers, ['a', 'b'])
	assert.equal(edit.jsonList(listed, ['disabledMcpjsonServers'], 'b', true), listed, 'already there: unchanged')
	assert.deepEqual(cfg.parseJson(edit.jsonList(listed, ['disabledMcpjsonServers'], 'a', false)).value.disabledMcpjsonServers, ['b'])
	assert.deepEqual(cfg.parseJson(edit.jsonList('', ['enabledMcpjsonServers'], 'a', true)).value, { enabledMcpjsonServers: ['a'] })
})

test('TOML: the parser reads every form Codex configs use', () => {
	const doc = toml.parseToml([
		'# top',
		'a = 1',
		'b.c = "dotted" # comment',
		"lit = 'C:\\path'",
		'multi = """',
		'one',
		'two"""',
		'arr = [',
		'  "x", # first',
		'  "y",',
		']',
		'inl = { k = "v", n = [1, 2] }',
		'[t."q.uoted"]',
		'esc = "tab\\there \\u00e9"',
		'[[arr_t]]',
		'n = 1',
		'[[arr_t]]',
		'n = 2',
	].join('\n'))
	assert.equal(doc.error, undefined)
	assert.deepEqual(doc.data.b, { c: 'dotted' })
	assert.equal(doc.data.lit, 'C:\\path')
	assert.equal(doc.data.multi, 'one\ntwo')
	assert.deepEqual(doc.data.arr, ['x', 'y'])
	assert.deepEqual(doc.data.inl, { k: 'v', n: [1, 2] })
	assert.equal(doc.data.t['q.uoted'].esc, 'tab\there é')
	assert.deepEqual(doc.data.arr_t, [{ n: 1 }, { n: 2 }])
	assert.deepEqual(doc.entries.find(e => e.path.join('.') === 'arr'), { path: ['arr'], start: 7, end: 11, inline: undefined })
	assert.match(toml.parseToml('a = 1\na = 2').error, /twice/)
	assert.match(toml.parseToml('[x\n').error, /line 1/)
})

const CODEX = [
	'# my settings',
	'model = "o3"',
	'',
	'[mcp_servers.docs]',
	'command = "npx"',
	'args = ["-y", "docs"]',
	'startup_timeout_sec = 20',
	'',
	'[mcp_servers.docs.env]',
	'TOKEN = "t"',
	'',
	'# the search server',
	'[mcp_servers.search]',
	'url = "https://s.example"',
	'',
	'[profiles.x]',
	'model = "o4"',
	'',
].join('\n')

test('TOML edits: replace keeps other keys and comments, add appends, remove leaves the rest byte for byte', () => {
	const replaced = toml.setTable(CODEX, ['mcp_servers', 'docs'], edit.codexEntry({ transport: 'stdio', command: 'docs-bin', args: [], env: { TOKEN: 't', NEW: 'n' } }, { command: 'npx', args: ['-y', 'docs'], startup_timeout_sec: 20, env: { TOKEN: 't' } }))
	const d = toml.parseToml(replaced)
	assert.equal(d.error, undefined, d.error)
	assert.deepEqual(d.data.mcp_servers.docs, { command: 'docs-bin', args: [], startup_timeout_sec: 20, env: { TOKEN: 't', NEW: 'n' } })
	assert.ok(replaced.includes('# the search server\n[mcp_servers.search]'), 'the comment above the next server stays with it')
	assert.ok(replaced.startsWith('# my settings\nmodel = "o3"\n'))
	assert.equal(d.data.profiles.x.model, 'o4')

	const added = toml.setTable(CODEX, ['mcp_servers', 'new.one'], edit.codexEntry({ transport: 'http', url: 'https://n.example', headers: {} }))
	assert.ok(added.startsWith(CODEX.trimEnd()), 'appending never touches what is there')
	assert.ok(added.endsWith('[mcp_servers."new.one"]\nurl = "https://n.example"\n'), added)

	const removed = toml.setTable(CODEX, ['mcp_servers', 'docs'], undefined)
	assert.equal(removed, CODEX.replace('[mcp_servers.docs]\ncommand = "npx"\nargs = ["-y", "docs"]\nstartup_timeout_sec = 20\n\n[mcp_servers.docs.env]\nTOKEN = "t"\n\n', ''))

	const off = edit.setCodexEnabled(CODEX, ['mcp_servers', 'search'], false)
	assert.ok(off.includes('[mcp_servers.search]\nenabled = false\nurl'))
	assert.equal(edit.setCodexEnabled(off, ['mcp_servers', 'search'], true), CODEX, 'on again: the line goes, the file is as it was')
	assert.equal(toml.setTable(CODEX.replace(/\n/g, '\r\n'), ['mcp_servers', 'search'], { url: 'u' }).includes('\r\n'), true, 'CRLF files stay CRLF')
})

test('TOML edits refuse what they cannot change safely', () => {
	assert.throws(() => toml.setTable('[mcp_servers]\ndocs = { command = "x" }\n', ['mcp_servers', 'docs'], { command: 'y' }), /inline/)
	assert.throws(() => toml.setTable('mcp_servers.docs.command = "x"\n', ['mcp_servers', 'docs'], undefined), /by hand/)
	assert.throws(() => toml.setTable('a = \n', ['mcp_servers', 'x'], {}), /not valid TOML/)
	assert.equal(toml.setTable('', ['mcp_servers', 'x'], { command: 'c' }), '[mcp_servers.x]\ncommand = "c"\n')
})

test('the excerpt a preview shows is only the server, with secrets hidden', () => {
	const cj = JSON.stringify({ oauthAccount: { emailAddress: 'x@example.com' }, mcpServers: { s: { command: 'c', env: { K: SECRET } } } })
	const ex = edit.excerpt(cj, 'json', [['mcpServers', 's']])
	assert.ok(!ex.includes('oauthAccount'))
	assert.ok(!cfg.maskText(ex, [SECRET]).includes(SECRET))
	assert.match(edit.excerpt(CODEX, 'toml', [['mcp_servers', 'docs']]), /^\[mcp_servers\.docs\][\s\S]*TOKEN = "t"\n$/)
})

test('CLI command lines and finding a program that starts without a shell', () => {
	assert.deepEqual(edit.claudeAddArgs('x', { transport: 'stdio', command: 'node', args: ['s.js'], env: { A: 'b' } }, 'local'),
		['mcp', 'add-json', 'x', '{"type":"stdio","command":"node","args":["s.js"],"env":{"A":"b"}}', '--scope', 'local'])
	assert.deepEqual(edit.codexAddArgs('x', { transport: 'stdio', command: 'npx', args: ['-y', 'p'], env: { A: 'b' } }), ['mcp', 'add', 'x', '--env', 'A=b', '--', 'npx', '-y', 'p'])
	assert.deepEqual(edit.codexAddArgs('x', { transport: 'http', url: 'https://u' }), ['mcp', 'add', 'x', '--url', 'https://u'])
	assert.equal(edit.codexAddArgs('x', { transport: 'http', url: 'https://u', headers: { H: 'v' } }), undefined, 'headers need the file')
	const files = new Set(['C:\\bin\\codex.cmd', 'C:\\tools\\claude.exe', '/usr/bin/claude'])
	assert.equal(edit.findExecutable('codex', { PATH: 'C:\\bin;C:\\tools' }, 'win32', f => files.has(f)), undefined, 'a .cmd shim needs a shell')
	assert.equal(edit.findExecutable('claude', { Path: 'C:\\bin;C:\\tools' }, 'win32', f => files.has(f)), 'C:\\tools\\claude.exe')
	assert.equal(edit.findExecutable('claude', { PATH: '/bin:/usr/bin' }, 'linux', f => files.has(f)), '/usr/bin/claude')
	assert.deepEqual(edit.splitCommandLine(`npx -y "@scope/pkg name" '--x=a b' ""`), ['npx', '-y', '@scope/pkg name', '--x=a b', ''])
	assert.equal(edit.NAME.test('my-server_1'), true)
	assert.equal(edit.NAME.test('a.b'), false)
})
