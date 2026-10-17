// The permission simulator (src/permmatch.ts) against the matching Claude Code documents: one test per rule shape
// that is easy to get wrong, so the "Why?" view never tells someone a call is allowed when Claude Code would ask.
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { build } from 'esbuild'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
let m
let tmp
before(async () => {
	tmp = mkdtempSync(join(tmpdir(), 'flow-perm-'))
	const outfile = join(tmp, 'permmatch.mjs')
	await build({ entryPoints: [join(ROOT, 'src', 'permmatch.ts')], bundle: true, platform: 'node', format: 'esm', outfile, logLevel: 'silent' })
	m = await import(pathToFileURL(outfile).href)
})
after(() => rmSync(tmp, { recursive: true, force: true }))

const CTX = { cwd: '/work/app', home: '/home/me' }
const rule = (pattern, effect = 'allow', scope = 'project', file = 'project') => ({ pattern, effect, scope, file })
const sim = (text, rules, ctx = CTX) => m.simulate(m.parseCall(text), rules, ctx)
const decide = (text, rules, ctx) => sim(text, rules, ctx).decision

test('a call parses to the tool up to the first ( and the argument up to the last )', () => {
	assert.deepEqual(m.parseCall('Bash(echo (a) b)'), { tool: 'Bash', arg: 'echo (a) b' })
	assert.deepEqual(m.parseCall('WebSearch'), { tool: 'WebSearch', arg: '' })
	assert.deepEqual(m.parseCall('mcp__github__create_issue'), { tool: 'mcp__github__create_issue', arg: '' })
	assert.deepEqual(m.parseCall('git push --force'), { tool: 'Bash', arg: 'git push --force' }, 'a bare command is read as Bash')
})

test('deny wins over ask and allow, from any scope, whatever is more specific', () => {
	const v = sim('Bash(aws s3 ls)', [rule('Bash(aws s3 ls)', 'allow', 'local'), rule('Bash(aws *)', 'deny', 'user', 'user')])
	assert.equal(v.decision, 'deny')
	assert.equal(v.rule.pattern, 'Bash(aws *)')
	assert.equal(decide('Bash(git push origin main)', [rule('Bash(git push *)', 'ask'), rule('Bash(git push origin main)')]), 'ask')
})

test('Bash wildcards follow the documented table', () => {
	const ok = (r, cmd) => m.bashMatches(m.parseRule(r).spec, cmd)
	assert.ok(ok('Bash(npm run build)', 'npm run build'))
	assert.ok(!ok('Bash(npm run build)', 'npm run build --watch'))
	assert.ok(ok('Bash(npm run *)', 'npm run test --watch'))
	assert.ok(ok('Bash(npm run *)', 'npm run'), 'a trailing " *" that is the only wildcard matches the bare command')
	assert.ok(!ok('Bash(npm run *)', 'npm install'))
	assert.ok(ok('Bash(git log * main)', 'git log --oneline main'))
	assert.ok(!ok('Bash(git log * main)', 'git log main'))
	assert.ok(ok('Bash(* --version)', 'node --version'))
	assert.ok(!ok('Bash(* --version)', 'node -v'))
	assert.ok(ok('Bash(ls *)', 'ls'))
	assert.ok(!ok('Bash(ls *)', 'lsof'), 'the space before * is part of the rule')
	assert.ok(ok('Bash(ls*)', 'lsof'))
	assert.ok(ok('Bash(* --help *)', 'npm --help x'))
	assert.ok(!ok('Bash(* --help *)', 'npm --help'), 'with two wildcards the bare form is not matched')
	assert.ok(ok('Bash(ls:*)', 'ls -la'), ':* at the end is a trailing wildcard')
	assert.ok(!ok('Bash(git:* push)', 'git push'), ':* elsewhere is literal')
	assert.ok(ok('Bash', 'anything at all') && ok('Bash(*)', 'rm -rf /'))
})

test('compound commands: allow needs every part, deny and ask need any part', () => {
	assert.equal(decide('Bash(npm test && rm -rf build)', [rule('Bash(npm test *)')]), 'ask')
	assert.equal(decide('Bash(npm test && npm run lint)', [rule('Bash(npm test *)'), rule('Bash(npm run *)')]), 'allow')
	assert.equal(decide('Bash(cd /tmp && git clean -f)', [rule('Bash(git clean *)', 'ask'), rule('Bash')]), 'ask')
	assert.equal(decide('Bash(echo "$(git clean -f)")', [rule('Bash(git clean *)', 'deny'), rule('Bash')]), 'deny', 'a command substitution is reached by deny')
	assert.equal(decide('Bash(npm test | tee out.log)', [rule('Bash(npm test *)')]), 'ask', 'tee writes a file: not read-only, no rule')
	assert.deepEqual(m.splitCompound('a && b || c; d | e |& f & g\nh'), ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'])
	assert.deepEqual(m.splitCompound('echo "a && b" && c'), ['echo "a && b"', 'c'], 'operators inside quotes do not split')
	assert.deepEqual(m.splitCompound('make 2>&1'), ['make 2>&1'], '2>&1 is a redirection')
	const v = sim('Bash(npm test &&)', [rule('Bash(npm *)')])
	assert.equal(v.decision, 'ask', 'a trailing && is unparseable: no allow rule approves it')
	assert.ok(v.notes.some(n => /unparseable/.test(n)))
})

test('wrappers and environment assignments', () => {
	assert.equal(decide('Bash(timeout 30 npm test)', [rule('Bash(npm test *)')]), 'allow')
	assert.equal(decide('Bash(nice -n 5 npm test)', [rule('Bash(npm test *)')]), 'allow')
	assert.equal(decide('Bash(xargs grep foo)', [rule('Bash(grep *)'), rule('Bash(grep *)', 'ask')]), 'ask')
	assert.equal(m.stripWrappers('xargs -n1 grep foo', true).command, 'xargs -n1 grep foo', 'xargs with flags is not stripped')
	assert.equal(m.stripWrappers('command -v node', true).command, 'command -v node', 'the query form is not stripped')
	assert.equal(decide('Bash(NODE_ENV=test npm test)', [rule('Bash(npm test *)')]), 'allow', 'a known-safe assignment is stripped')
	assert.equal(decide('Bash(FOO=bar npm test)', [rule('Bash(npm test *)')]), 'ask', 'any other assignment stops an allow')
	assert.equal(decide('Bash(FOO=bar rm -rf tmp/)', [rule('Bash(rm *)', 'deny')]), 'deny', 'a deny sees past any assignment')
})

test('exec wrappers and find actions are never approved by a prefix rule, only by an exact one', () => {
	assert.equal(decide('Bash(watch make)', [rule('Bash(watch *)')]), 'ask')
	assert.equal(decide('Bash(find build -type f -delete)', [rule('Bash(find *)')]), 'ask')
	assert.equal(decide('Bash(find build -type f -delete)', [rule('Bash(find build -type f -delete)')]), 'allow')
})

test('built-in read-only commands run without a rule, unless a rule asks', () => {
	const v = sim('Bash(ls -la)', [])
	assert.equal(v.decision, 'allow')
	assert.equal(v.by, 'builtin')
	assert.equal(decide('Bash(git status)', []), 'allow')
	assert.equal(decide('Bash(git push)', []), 'ask')
	assert.equal(decide('Bash(cd packages/api && ls)', []), 'allow')
	assert.equal(decide('Bash(ls > out.txt)', []), 'ask', 'a redirect writes a file')
	assert.equal(decide('Bash(ls 2>/dev/null)', []), 'allow')
	assert.equal(decide('Bash(cat .env)', [rule('Bash(cat *)', 'ask')]), 'ask')
})

test('Read and Edit paths: the four anchors', () => {
	assert.equal(decide('Edit(/work/app/src/a.ts)', [rule('Edit(/src/**)')]), 'allow', '/path in project settings anchors at the project')
	assert.equal(decide('Edit(src/a.ts)', [rule('Edit(/src/**)', 'allow', 'user', 'user')]), 'ask', '/path in user settings anchors at ~/.claude')
	assert.equal(decide('Read(/home/me/.claude/src/a.ts)', [rule('Read(/src/**)', 'deny', 'user', 'user')]), 'deny')
	assert.equal(decide('Read(/tmp/scratch.txt)', [rule('Read(//tmp/**)', 'deny')]), 'deny', '// is the filesystem root')
	assert.equal(decide('Read(~/.zshrc)', [rule('Read(~/.zshrc)', 'deny')]), 'deny')
	assert.equal(decide('Edit(./docs/x.md)', [rule('Edit(./docs/**)')]), 'allow')
})

test('a single directory segment matches at any depth for deny and ask, only at the root for allow', () => {
	assert.equal(decide('Edit(vendor/pkg/src/lib.js)', [rule('Edit(src/**)')]), 'ask')
	assert.equal(decide('Edit(src/app.ts)', [rule('Edit(src/**)')]), 'allow')
	assert.equal(decide('Edit(vendor/pkg/src/lib.js)', [rule('Edit(src/**)', 'deny')]), 'deny')
	assert.equal(decide('Edit(vendor/pkg/src/lib.js)', [rule('Edit(/src/**)', 'deny')]), 'ask', '/src/** is anchored for every rule type')
	assert.equal(decide('Edit(vendor/pkg/src/lib.js)', [rule('Edit(**/src/**)')]), 'allow')
	assert.equal(decide('Read(a/b/.env)', [rule('Read(.env)', 'deny')]), 'deny', 'a bare name matches at any depth')
	assert.equal(decide('Read(/elsewhere/.env)', [rule('Read(.env)', 'deny')]), 'ask', 'but only under its anchor')
	assert.equal(decide('Read(src/x.ts)', [rule('Read(src/*.ts)', 'deny')]), 'deny')
	assert.equal(decide('Read(src/deep/x.ts)', [rule('Read(src/*.ts)', 'deny')]), 'allow', '* stays in one segment; the read is in the working directory')
})

test('a Read deny also blocks Edit and Write, not NotebookEdit; Write and Glob path rules are never consulted', () => {
	assert.equal(decide('Write(secrets/k.txt)', [rule('Read(secrets/**)', 'deny'), rule('Edit')]), 'deny')
	assert.equal(decide('NotebookEdit(secrets/n.ipynb)', [rule('Read(secrets/**)', 'deny'), rule('Edit')]), 'allow')
	const v = sim('Write(docs/a.md)', [rule('Write(docs/**)')])
	assert.equal(v.decision, 'ask')
	assert.ok(v.notes.some(n => /never consulted/.test(n)))
	assert.equal(decide('Write(docs/a.md)', [rule('Write', 'deny')]), 'deny', 'a bare Write rule still matches the tool')
	assert.equal(decide('Grep(src)', [rule('Read(src/**)', 'deny')]), 'deny', 'Read rules cover Grep and Glob')
})

test('reads in the working directory need no rule; outside they ask', () => {
	assert.equal(decide('Read(src/a.ts)', []), 'allow')
	assert.equal(decide('Read(/etc/hosts)', []), 'ask')
	assert.equal(decide('Read(/extra/x)', [], { ...CTX, additionalDirs: ['/extra'] }), 'allow')
})

test('! carve-outs cancel an earlier relative rule of the same file only', () => {
	const deny = [rule('Read(*.env)', 'deny', 'project', 'p'), rule('Read(!sample.env)', 'deny', 'project', 'p')]
	assert.equal(decide('Read(sample.env)', deny), 'allow')
	assert.equal(decide('Read(prod.env)', deny), 'deny')
	assert.equal(decide('Read(sample.env)', [rule('Read(*.env)', 'deny', 'user', 'u'), rule('Read(!sample.env)', 'deny', 'project', 'p')]), 'deny', 'another file cannot carve it out')
	assert.equal(decide('Read(secrets/public/a)', [rule('Read(secrets/**)', 'deny', 'project', 'p'), rule('Read(!secrets/public/**)', 'deny', 'project', 'p')]), 'deny', 'a blocked directory stays blocked')
})

test('Windows paths are matched in POSIX form, ignoring case', () => {
	const win = { cwd: 'C:\\work\\app', home: 'C:\\Users\\me' }
	assert.equal(m.posixPath('C:\\Users\\alice'), '/c/Users/alice')
	assert.equal(decide('Read(C:\\work\\app\\.ENV)', [rule('Read(.env)', 'deny')], win), 'deny')
	assert.equal(decide('Read(D:\\x\\.env)', [rule('Read(//**/.env)', 'deny')], win), 'deny')
	assert.equal(decide('Edit(src\\a.ts)', [rule('Edit(/src/**)')], win), 'allow')
})

test('WebFetch domains', () => {
	assert.ok(m.domainMatches('domain:example.com', 'EXAMPLE.com.'))
	assert.ok(!m.domainMatches('domain:example.com', 'api.example.com'))
	assert.ok(m.domainMatches('domain:*.example.com', 'a.b.example.com'))
	assert.ok(!m.domainMatches('domain:*.example.com', 'example.com'))
	assert.ok(m.domainMatches('domain:example.*', 'example.org'))
	assert.ok(!m.domainMatches('domain:example.*', 'example.evil.com'))
	assert.equal(decide('WebFetch(https://github.com/a/b)', [rule('WebFetch(domain:github.com)')]), 'allow')
	assert.equal(decide('WebFetch(https://evil.com)', [rule('WebFetch(domain:github.com)')]), 'ask')
	assert.equal(decide('WebFetch(https://x.io)', [rule('WebFetch', 'deny')]), 'deny')
})

test('MCP rules: server, server wildcard, one tool; allow globs need a literal server', () => {
	assert.equal(decide('mcp__puppeteer__navigate', [rule('mcp__puppeteer')]), 'allow')
	assert.equal(decide('mcp__puppeteer__navigate', [rule('mcp__puppeteer__*')]), 'allow')
	assert.equal(decide('mcp__github__get_issue', [rule('mcp__github__get_*')]), 'allow')
	assert.equal(decide('mcp__github__create_issue', [rule('mcp__github__get_*')]), 'ask')
	assert.equal(decide('mcp__github__get_issue', [rule('mcp__*')]), 'ask', 'an unanchored allow glob approves nothing')
	assert.equal(decide('mcp__github__get_issue', [rule('mcp__*', 'deny')]), 'deny', 'deny may glob tool names')
	const v = sim('mcp__github__get_issue', [rule('mcp__github__get_issue(owner:x)', 'deny')])
	assert.equal(v.decision, 'ask')
	assert.ok(v.notes.some(n => /parentheses/.test(n)))
	assert.equal(decide('mcp__pup__x', [rule('mcp__puppeteer')]), 'ask', 'a server name is not a prefix match')
})

test('Agent rules, the Task alias, and parameter rules', () => {
	assert.equal(decide('Agent(Explore)', [rule('Agent(Explore)', 'deny')]), 'deny')
	assert.equal(decide('Task(Explore)', [rule('Agent(Explore)', 'deny')]), 'deny')
	assert.equal(decide('Agent(Plan)', [rule('Agent(Explore)', 'deny')]), 'allow', 'subagents need no approval otherwise')
	assert.equal(decide('Bash(npm test)', [rule('Bash(run_in_background:true)', 'deny'), rule('Bash(npm test)')]), 'allow', 'a parameter rule never matches the command text')
	assert.equal(decide('Bash(ls:foo)', [rule('Bash(ls:foo)', 'deny')]), 'deny', 'a colon that is not a Bash parameter is part of the command')
	assert.ok(sim('Bash(rm x)', [rule('Bash(command:rm *)', 'deny')]).notes.some(n => /command parameter/.test(n)))
})

test('the permission mode decides what no rule does', () => {
	const mode = m => ({ ...CTX, mode: m })
	assert.equal(decide('Edit(src/a.ts)', [], mode('acceptEdits')), 'allow')
	assert.equal(decide('Edit(/elsewhere/a.ts)', [], mode('acceptEdits')), 'ask')
	assert.equal(decide('Edit(src/a.ts)', [], mode('plan')), 'deny')
	assert.equal(decide('Bash(npm publish)', [], mode('dontAsk')), 'deny')
	assert.equal(decide('Bash(npm publish)', [rule('Bash(npm publish)')], mode('dontAsk')), 'allow', 'allow rules still run in dontAsk')
	assert.equal(decide('Bash(npm publish)', [], mode('bypassPermissions')), 'allow')
	assert.equal(decide('Bash(npm publish)', [rule('Bash(npm publish)', 'deny')], mode('bypassPermissions')), 'deny', 'a deny holds in every mode')
	assert.match(sim('Bash(npm publish)', [], mode('auto')).reason, /classifier/)
	assert.equal(decide('Bash(npm publish)', [], mode('manual')), 'ask', 'manual is an alias of default')
})

test('Codex: approval policy and sandbox', () => {
	const cfg = m.codexConfig('model = "o4"\napproval_policy = "never"\nsandbox_mode = "read-only"\n[profiles.x]\napproval_policy = "untrusted"\n')
	assert.deepEqual(cfg, { approval_policy: 'never', sandbox_mode: 'read-only' }, 'only top-level keys, profiles are not followed')
	const codex = (text, c) => m.simulateCodex(m.parseCall(text), c, CTX).decision
	assert.equal(codex('Edit(src/a.ts)', cfg), 'deny')
	assert.equal(codex('Edit(src/a.ts)', {}), 'allow', 'defaults: on-request, workspace-write')
	assert.equal(codex('Edit(/etc/x)', {}), 'ask')
	assert.equal(codex('Bash(npm test)', { approval_policy: 'untrusted' }), 'ask')
	assert.equal(codex('Read(src/a.ts)', { sandbox_mode: 'read-only' }), 'allow')
	assert.equal(codex('Bash(rm -rf x)', { sandbox_mode: 'danger-full-access', approval_policy: 'never' }), 'allow')
})

// The cases the merged-main review reproduced, each against code.claude.com/docs/en/permissions and /permission-modes.

test('protected paths are checked before allow rules: Edit(.claude/**) does not pre-approve settings.json', () => {
	const allow = [rule('Edit(.claude/**)')]
	const v = sim('Edit(.claude/settings.json)', allow)
	assert.equal(v.decision, 'ask')
	assert.equal(v.by, 'safety')
	assert.equal(decide('Edit(.claude/settings.json)', allow, { ...CTX, mode: 'acceptEdits' }), 'ask', 'acceptEdits prompts for protected paths')
	assert.equal(decide('Edit(.claude/settings.json)', allow, { ...CTX, mode: 'dontAsk' }), 'deny')
	assert.equal(decide('Edit(.claude/settings.json)', allow, { ...CTX, mode: 'bypassPermissions' }), 'allow')
	assert.match(sim('Edit(.claude/settings.json)', allow, { ...CTX, mode: 'auto' }).reason, /classifier/)
	assert.equal(decide('Edit(.claude/settings.json)', [rule('Edit(.claude/**)', 'deny')]), 'deny', 'a deny still wins')
	assert.equal(decide('Edit(.git/config)', [rule('Edit')]), 'ask')
	assert.equal(decide('Write(.mcp.json)', [rule('Edit')]), 'ask', 'protected files by name')
	assert.equal(decide('Edit(.claude/worktrees/a/src/x.ts)', [rule('Edit')]), 'allow', "Claude's own worktrees are not protected")
	assert.equal(decide('Edit(.claude/agent-memory/notes.md)', [rule('Edit')]), 'allow', 'subagent memory Markdown is not protected')
	assert.equal(decide('Edit(~/.claude/projects/p/memory/a.md)', [rule('Edit')]), 'allow', 'auto memory Markdown is not protected')
	assert.equal(decide('Edit(src/x.ts)', [rule('Edit')]), 'allow')
})

test('no allow rule approves rm of a critical path; a deny still blocks it', () => {
	const v = sim('Bash(rm -rf /)', [rule('Bash(rm -rf *)')])
	assert.equal(v.decision, 'ask')
	assert.equal(v.by, 'safety')
	for (const cmd of ['rm -rf ~', 'rm -rf $HOME', 'rm -rf /usr', 'rm -rf /work', 'rm -rf .', 'rm -rf ..', 'rm -rf "$DIR"/*', 'rm -rf "$(pwd)"', 'rmdir /work/app', 'rm -rf ~/*']) {
		assert.equal(decide(`Bash(${cmd})`, [rule('Bash')]), 'ask', cmd)
	}
	assert.equal(decide('Bash(rm -rf build)', [rule('Bash(rm -rf *)')]), 'allow', 'an ordinary target')
	assert.equal(decide('Bash(rm -rf "${DIR:?}"/*)', [rule('Bash(rm -rf *)')]), 'allow', 'a guarded expansion passes')
	assert.equal(decide('Bash(cd x && rm -rf /)', [rule('Bash')]), 'ask', 'in any part')
	assert.equal(decide('Bash(echo "$(rm -rf ~)")', [rule('Bash')]), 'ask', 'nested')
	assert.equal(decide('Bash(rm -rf /)', [rule('Bash(rm -rf *)')], { ...CTX, mode: 'bypassPermissions' }), 'ask', 'even bypassPermissions asks')
	assert.equal(decide('Bash(rm -rf /)', [rule('Bash(rm -rf *)')], { ...CTX, mode: 'dontAsk' }), 'deny')
	assert.equal(decide('Bash(rm -rf /)', [rule('Bash(rm *)', 'deny')]), 'deny')
	const win = { cwd: 'C:\\w\\app', home: 'C:\\Users\\me' }
	assert.equal(decide('Bash(rm -rf C:/Windows)', [rule('Bash')], win), 'ask', 'a drive top-level directory')
	assert.equal(decide('Bash(rm -rf C:/w/app/dist)', [rule('Bash')], win), 'allow')
	assert.equal(decide('Bash(rm -rf /extra/*)', [rule('Bash')], { ...CTX, additionalDirs: ['/extra'] }), 'ask', 'a glob under an additional directory')
})

test('deny and ask reach the bodies of loops and conditionals, and allow must cover them', () => {
	const deny = [rule('Bash(git clean *)', 'deny')]
	assert.equal(decide('Bash(for f in a; do git clean -f; done)', deny), 'deny')
	assert.equal(decide('Bash(if true; then git clean -fd; fi)', deny), 'deny')
	assert.equal(decide('Bash(while true; do git clean -f; done)', deny), 'deny')
	assert.equal(decide('Bash(for f in a b; do echo $f; done)', []), 'allow', 'a loop of read-only commands')
	assert.equal(decide('Bash(for f in a; do npm test; done)', [rule('Bash(npm test)')]), 'allow')
	assert.equal(decide('Bash(for f in a; do npm publish; done)', [rule('Bash(npm test)')]), 'ask')
	assert.equal(m.commandOfPart('do git clean -f'), 'git clean -f')
	assert.equal(m.commandOfPart('done'), undefined)
	assert.equal(m.commandOfPart('for f in *'), undefined)
})

test('cd: read-only into a working directory, but cd into another directory with git asks', () => {
	assert.equal(decide('Bash(cd packages/api && ls)', []), 'allow')
	assert.equal(decide('Bash(cd packages/api && git status)', []), 'ask')
	assert.match(sim('Bash(cd packages/api && git status)', []).notes.join(' '), /hooks/)
	assert.equal(decide('Bash(cd . && git status)', []), 'allow', 'a cd to the current directory is a no-op')
	assert.equal(decide('Bash(cd /tmp && ls)', []), 'ask', 'outside the working directories')
	assert.equal(decide('Bash(cd /tmp && ls)', [], { ...CTX, additionalDirs: ['/tmp'] }), 'allow')
})

test('acceptEdits runs its filesystem commands only for paths inside the working directories, part by part', () => {
	const ae = { ...CTX, mode: 'acceptEdits' }
	assert.equal(decide('Bash(mv a.txt b.txt)', [], ae), 'allow')
	assert.equal(decide('Bash(mv notes.txt /etc/notes)', [], ae), 'ask')
	assert.equal(decide('Bash(mkdir -p src/new && touch src/new/a.ts)', [], ae), 'allow')
	assert.equal(decide('Bash(mkdir x && curl https://example.com)', [], ae), 'ask', 'each part on its own')
	assert.equal(decide('Bash(rm -rf build)', [], ae), 'allow', 'rm is on the list')
	assert.equal(decide('Bash(rm -rf .)', [], ae), 'ask', 'but not on a critical path')
	assert.equal(decide("Bash(sed -i 's/a/b/' src/x.ts)", [], ae), 'allow')
	assert.equal(decide('Bash(cp a .git/hooks/pre-commit)', [], ae), 'ask', 'a protected path')
	assert.equal(decide('Bash(timeout 5 touch a)', [], ae), 'allow', 'wrappers are stripped')
	assert.equal(decide('Bash(mv a.txt b.txt)', []), 'ask', 'Manual mode asks')
	assert.equal(decide('Edit(/etc/hosts)', [], ae), 'ask')
})

test('parameter rules match the call input given as JSON, for deny and ask only', () => {
	const bg = [rule('Bash(run_in_background:true)', 'deny')]
	assert.equal(decide('Bash({"command":"npm test","run_in_background":true})', bg), 'deny')
	assert.equal(decide('Bash({"command":"npm test"})', [...bg, rule('Bash(npm test)')]), 'allow', 'an omitted parameter never matches')
	assert.equal(decide('Agent({"subagent_type":"x","model":"opus"})', [rule('Agent(model:opus)', 'ask'), rule('Agent')]), 'ask')
	assert.equal(decide('Agent({"subagent_type":"x","model":"claude-opus-5-5"})', [rule('Agent(model:opus)', 'ask'), rule('Agent')]), 'allow', 'compared as written')
	assert.equal(decide('Agent({"subagent_type":"x","isolation":"worktree"})', [rule('Agent(isolation:*)', 'deny')]), 'deny', '* in the value')
	assert.equal(decide('WebSearch({"query":"x","model":"opus"})', [rule('WebSearch(model:opus)'), rule('WebSearch', 'ask')]), 'ask', 'an allow parameter rule approves nothing')
	assert.equal(m.parseCall('Bash({"command":"ls"})').arg, 'ls', 'the primary field is the argument')
	assert.match(sim('Bash(npm test)', [...bg, rule('Bash(npm test)')]).notes.join(' '), /JSON/, 'says the parameter rule was not checked')
	assert.equal(decide('Bash(git status)', [rule('Bash(git:*)')]), 'allow', 'git:* is a command prefix, not a parameter')
})

test('Windows paths: a drive letter is a path, not a parameter; //c/ is how a rule names it', () => {
	const win = { cwd: 'C:\\w\\app', home: 'C:\\Users\\me' }
	assert.equal(decide('Read(C:\\x\\.env)', [rule('Read(//c/x/.env)', 'deny')], win), 'deny')
	assert.equal(decide('Read(C:/x/.env)', [rule('Read(//c/**/.env)', 'deny')], win), 'deny')
	const v = sim('Read(C:/x/.env)', [rule('Read(C:/x/.env)', 'deny')], win)
	assert.notEqual(v.decision, 'deny', 'Claude Code reads a pattern without a leading / relative to the current directory')
	assert.match(v.notes.join(' '), /Read\(\/\/c\/x\/\.env\)/, 'and the note gives the documented form')
})

test('a read from a network path asks whatever the allow rules say', () => {
	assert.equal(decide('Read(\\\\server\\share\\a.txt)', [rule('Read')]), 'ask')
	assert.equal(decide('Read(//server/share/a.txt)', [rule('Read')]), 'ask')
	assert.equal(decide('Read(/net/files/a.txt)', [rule('Read')]), 'ask')
	assert.equal(decide('Read(\\\\server\\share\\a.txt)', [rule('Read')], { ...CTX, mode: 'dontAsk' }), 'deny')
	assert.equal(decide('Read(\\\\server\\share\\a.txt)', [rule('Read')], { ...CTX, mode: 'bypassPermissions' }), 'allow')
	assert.equal(decide('Read(\\\\server\\share\\a.txt)', [rule('Read', 'deny')]), 'deny')
})

test('the reason names the mode it assumed', () => {
	assert.match(sim('Bash(npm publish)', []).reason, /Manual mode/)
	assert.match(sim('Bash(npm publish)', [], { ...CTX, mode: 'acceptEdits' }).reason, /acceptEdits/)
})
