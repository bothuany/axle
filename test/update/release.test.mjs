// The release workflow (.github/workflows/release.yml) and what it runs: scripts/release-files.mjs puts a release together from the
// build jobs' artifacts, maps a version to what the Linux packages can hold, and scripts/curl-github-raw.sh is the Linux build's curl.
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { artifacts, assemble, collect, debVersion, isPrerelease, rpmVersion } from '../../scripts/release-files.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const temp = () => mkdtempSync(join(realpathSync.native(tmpdir()), 'insilode-release-'))

test('a prerelease sorts before its release in the Linux packages, and a release keeps its plain version', () => {
	assert.deepEqual([isPrerelease('0.6.0'), isPrerelease('0.6.0-rc.1')], [false, true])
	assert.equal(debVersion('0.6.0'), '0.6.0')
	assert.equal(debVersion('0.6.0-rc.1'), '0.6.0~rc.1')
	assert.equal(debVersion('0.6.0-beta-2'), '0.6.0~beta.2')
	assert.deepEqual(rpmVersion('0.6.0'), { version: '0.6.0', release: '1' })
	assert.deepEqual(rpmVersion('0.6.0-rc.1'), { version: '0.6.0', release: '0.rc.1' })
	// dpkg's own ordering, where it is installed: 0.6.0~rc.1 < 0.6.0 < 0.6.1~rc.1.
	if (spawnSync('dpkg', ['--version']).status === 0) {
		const lt = (a, b) => spawnSync('dpkg', ['--compare-versions', a, 'lt', b]).status === 0
		assert.ok(lt(debVersion('0.6.0-rc.1'), debVersion('0.6.0')) && lt(debVersion('0.6.0'), debVersion('0.6.1-rc.1')))
	}
	assert.throws(() => debVersion('v0.6.0'), /not a version/)
})

/** A folder of build artifacts as download-artifact leaves them: one subfolder per artifact, each with its platform's files. */
function artifactsFor(version, { drop = [], extra = {} } = {}) {
	const dir = temp()
	for (const [artifact, { required, optional }] of Object.entries(artifacts(version))) {
		mkdirSync(join(dir, artifact))
		for (const name of [...required, ...optional].filter(n => !drop.includes(n))) {
			writeFileSync(join(dir, artifact, name), `${artifact}/${name}`)
		}
	}
	for (const [path, text] of Object.entries(extra)) {
		mkdirSync(dirname(join(dir, path)), { recursive: true })
		writeFileSync(join(dir, path), text)
	}
	return dir
}

test('a release is every platform\'s files, SHA256SUMS.txt over them, and the update files', async () => {
	const out = join(temp(), 'release')
	const written = await assemble({ artifactsDir: artifactsFor('0.6.0'), out, version: '0.6.0', commit: 'abc', repo: 'bothuany/insilode', timestamp: 1 })
	const files = readdirSync(out).sort()
	assert.deepEqual(files, [...written].sort())
	for (const name of ['Insilode-Setup-0.6.0-x64.exe', 'Insilode-0.6.0-darwin-arm64.dmg', 'insilode_0.6.0_amd64.deb', 'insilode-0.6.0-1.x86_64.rpm', 'SHA256SUMS.txt', 'update-win32-x64-user-insilode.json', 'update-darwin-arm64-axle.json']) {
		assert.ok(files.includes(name), name)
	}
	const sums = readFileSync(join(out, 'SHA256SUMS.txt'), 'utf8').trim().split('\n')
	assert.equal(sums.length, 8, 'one line per release file')
	assert.match(sums.find(l => l.endsWith('  Insilode-Setup-0.6.0-x64.exe')), /^[0-9a-f]{64}  /)
	const win = JSON.parse(readFileSync(join(out, 'update-win32-x64-user-insilode.json'), 'utf8'))
	assert.equal(win.sha256hash, sums.find(l => l.endsWith('Insilode-Setup-0.6.0-x64.exe')).split('  ')[0], 'the update file vouches for the file that is uploaded')
	assert.equal(win.url, 'https://github.com/bothuany/insilode/releases/download/v0.6.0/Insilode-Setup-0.6.0-x64.exe')
})

test('a prerelease gets no update files, so no installed Insilode updates to it', async () => {
	const out = join(temp(), 'release')
	await assemble({ artifactsDir: artifactsFor('0.6.0-rc.1'), out, version: '0.6.0-rc.1', commit: 'abc', repo: 'bothuany/insilode' })
	assert.deepEqual(readdirSync(out).filter(n => n.startsWith('update-')), [])
	assert.ok(existsSync(join(out, 'SHA256SUMS.txt')) && existsSync(join(out, 'insilode_0.6.0-rc.1_amd64.deb')))
})

test('the RPM is best effort; any other missing file, a missing artifact or a stray file stops the release', () => {
	assert.equal(collect(artifactsFor('0.6.0', { drop: ['insilode-0.6.0-1.x86_64.rpm'] }), '0.6.0').length, 7)
	assert.throws(() => collect(artifactsFor('0.6.0', { drop: ['Insilode-0.6.0-darwin-x64.dmg'] }), '0.6.0'), /insilode-darwin-x64 has no Insilode-0\.6\.0-darwin-x64\.dmg/)
	// A Windows installer in the Linux artifact cannot stand in for the one the Windows job did not make.
	const swapped = artifactsFor('0.6.0', { drop: ['Insilode-Setup-0.6.0-x64.exe'], extra: { 'insilode-linux-x64/Insilode-Setup-0.6.0-x64.exe': 'x' } })
	assert.throws(() => collect(swapped, '0.6.0'), err => /insilode-win32-x64 has no Insilode-Setup/.test(err.message) && /insilode-linux-x64 holds Insilode-Setup/.test(err.message))
	assert.throws(() => collect(artifactsFor('0.6.0', { extra: { 'insilode-other-x64/a.zip': 'x' } }), '0.6.0'), /an artifact nobody asked for: insilode-other-x64/)
	assert.throws(() => collect(artifactsFor('0.5.9'), '0.6.0'), /not a release file of 0\.6\.0/)
})

test('release.yml: only the publish job can write, it runs no repository code, and no checkout keeps the token', () => {
	// A Windows checkout with core.autocrlf=true has CRLF line ends.
	const yml = readFileSync(join(ROOT, '.github', 'workflows', 'release.yml'), 'utf8').replace(/\r\n/g, '\n')
	const body = yml.split(/^jobs:\n/m)[1]
	const heads = [...body.matchAll(/^ {2}([a-z-]+):$/gm)]
	const jobs = Object.fromEntries(heads.map((h, i) => [h[1], body.slice(h.index, heads[i + 1]?.index)]))
	assert.deepEqual(Object.keys(jobs), ['version', 'installer', 'packages', 'assemble', 'publish'])
	assert.match(yml.split(/^jobs:/m)[0], /^permissions:\n {2}contents: read$/m)
	assert.equal(yml.match(/contents: write/g).length, 1)
	assert.match(jobs.publish, /contents: write/)
	assert.doesNotMatch(jobs.publish, /actions\/checkout|scripts\/|npm /, 'publish runs nothing from the repository')
	assert.match(jobs.publish, /if: needs\.version\.outputs\.publish == 'true'/)
	assert.match(jobs.publish, /needs: \[version, assemble\]/)
	for (const [name, job] of Object.entries(jobs).filter(([n]) => n !== 'publish')) {
		assert.doesNotMatch(job, /secrets\.GITHUB_TOKEN/, `${name} has no write token`)
		for (const checkout of job.split('actions/checkout@').slice(1)) {
			assert.match(checkout.split('\n      - ')[0], /persist-credentials: false/, `${name}: checkout keeps no credentials`)
		}
	}
	// Draft first, every file, then public; a prerelease is never latest.
	const steps = jobs.publish.slice(jobs.publish.indexOf('gh release create'))
	assert.ok(steps.indexOf('--draft') >= 0 && steps.indexOf('gh release upload') < steps.indexOf('--draft=false'))
	assert.match(jobs.publish, /--draft=false --prerelease --latest=false/)
	assert.match(jobs.assemble, /scripts\/release-files\.mjs/)
	assert.doesNotMatch(jobs.assemble.replace(/#.*$/gm, ''), /merge-multiple/)
})

const shim = join(ROOT, 'scripts', 'curl-github-raw.sh')
// On Windows `bash` on PATH may be WSL's, which cannot run a Windows path: Git's bash, where it is installed.
const GIT_BASH = 'C:\\Program Files\\Git\\bin\\bash.exe'
const bash = process.platform !== 'win32' ? (spawnSync('bash', ['--version']).status === 0 ? 'bash' : '') : existsSync(GIT_BASH) ? GIT_BASH : ''
test('the Linux build\'s curl: a raw.githubusercontent.com download goes through the API with the token; anything else is untouched', { skip: bash ? false : 'needs bash (the shim runs on the Linux runner)' }, () => {
	const fake = join(temp(), 'curl')
	writeFileSync(fake, '#!/usr/bin/env bash\nprintf \'%s\\n\' "$@"\n')
	chmodSync(fake, 0o755)
	const curl = (...args) => spawnSync(bash, [shim, ...args], { encoding: 'utf8', env: { ...process.env, INSILODE_REAL_CURL: fake, GITHUB_TOKEN: 'secret' } }).stdout.trim().split('\n')
	const api = 'https://api.github.com/repos/chromium/chromium/contents/third_party/dpkg-shlibdeps/dpkg-shlibdeps.pl'
	for (const [ref, want] of [['0123abc', '0123abc'], ['refs/heads/main', 'main'], ['refs/tags/v1.2', 'v1.2']]) {
		const out = curl('-sSL', '-o', 'x.pl', `https://raw.githubusercontent.com/chromium/chromium/${ref}/third_party/dpkg-shlibdeps/dpkg-shlibdeps.pl`)
		assert.equal(out[3], `${api}?ref=${want}`, ref)
		assert.ok(out.includes('--fail') && out.includes('Authorization: Bearer secret') && out.includes('Accept: application/vnd.github.raw'), out.join(' '))
	}
	assert.equal(curl('--url=https://raw.githubusercontent.com/o/r/sha/p.txt')[0], '--url=https://api.github.com/repos/o/r/contents/p.txt?ref=sha')
	// Another URL in the same call would get the header too: such a call, and one that is not a raw download, run as they are.
	assert.deepEqual(curl('https://raw.githubusercontent.com/o/r/sha/p.txt', 'https://example.com/'), ['https://raw.githubusercontent.com/o/r/sha/p.txt', 'https://example.com/'])
	assert.deepEqual(curl('-fsS', 'https://example.com/a'), ['-fsS', 'https://example.com/a'])
	assert.deepEqual(curl('https://raw.githubusercontent.com/o/r/refs/pull/1/p'), ['https://raw.githubusercontent.com/o/r/refs/pull/1/p'], 'a ref it cannot read with certainty')
})
