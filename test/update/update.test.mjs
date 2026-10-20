// The update service of the Axle app (editor/patches/flow-update.patch) and the files the release job writes for it.
// axleUpdate.ts is pure TypeScript: it is cut out of the patch (what ships, not a copy) and run by Node's type stripping.
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, readdirSync, realpathSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { QUALITY, buildManifests, platforms } from '../../scripts/update-manifests.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const readPatch = name => readFileSync(join(ROOT, 'editor', 'patches', name), 'utf8').replace(/\r\n/g, '\n')
const patch = readPatch('flow-update.patch')
// product.json is changed by the core patch only: when two patches touch one file, the build's "are the patches applied"
// check (`git apply --reverse --check` per patch) fails on the first of them.
const corePatch = readPatch('flow-core.patch')

/** The added lines of one file of a patch (the update patch unless another is given). */
function addedLines(file, from = patch) {
	const section = from.split(/^diff --git /m).find(part => part.startsWith(`a/${file} `))
	assert.ok(section, `${file} is not in the patch`)
	return section.split('\n').slice(section.split('\n').findIndex(line => line.startsWith('@@')) + 1).filter(line => line.startsWith('+')).map(line => line.slice(1))
}

const dir = mkdtempSync(join(realpathSync.native(tmpdir()), 'axle-update-'))
writeFileSync(join(dir, 'axleUpdate.ts'), addedLines('src/vs/platform/update/electron-main/axleUpdate.ts').join('\n') + '\n')
const { createAxleUpdateURL, resolveAxleUpdateBaseUrl, compareVersions, parseAxleUpdate } = await import(pathToFileURL(join(dir, 'axleUpdate.ts')).href)

const BASE = 'https://github.com/bothuany/axle/releases/latest/download'
const update = (productVersion, extra = {}) => ({ url: 'https://example.test/x.exe', name: 'Axle', version: 'abc123', productVersion, sha256hash: 'f'.repeat(64), timestamp: 1, ...extra })

test('the update file of a platform sits next to the release assets', () => {
	assert.equal(createAxleUpdateURL(BASE, 'win32-x64-user', 'axle'), `${BASE}/update-win32-x64-user-axle.json`)
	assert.equal(createAxleUpdateURL(`${BASE}/`, 'darwin-arm64', 'axle'), `${BASE}/update-darwin-arm64-axle.json`)
	assert.equal(createAxleUpdateURL(BASE, 'linux-x64', 'axle'), `${BASE}/update-linux-x64-axle.json`)
})

test('AXLE_UPDATE_URL is honoured for https and for this machine only', () => {
	assert.equal(resolveAxleUpdateBaseUrl(BASE, undefined), BASE)
	assert.equal(resolveAxleUpdateBaseUrl(BASE, 'http://127.0.0.1:8123'), 'http://127.0.0.1:8123')
	assert.equal(resolveAxleUpdateBaseUrl(BASE, 'http://localhost:8123/x'), 'http://localhost:8123/x')
	assert.equal(resolveAxleUpdateBaseUrl(BASE, 'https://mirror.test/axle'), 'https://mirror.test/axle')
	assert.equal(resolveAxleUpdateBaseUrl(BASE, 'http://evil.test/axle'), BASE)
	assert.equal(resolveAxleUpdateBaseUrl(BASE, 'file:///etc'), BASE)
	assert.equal(resolveAxleUpdateBaseUrl(BASE, 'not a url'), BASE)
})

test('versions compare by semver', () => {
	const order = (a, b) => Math.sign(compareVersions(a, b))
	assert.equal(order('0.4.2', '0.4.1'), 1)
	assert.equal(order('0.4.1', '0.4.1'), 0)
	assert.equal(order('0.4.1', '0.4.2'), -1)
	assert.equal(order('0.10.0', '0.9.9'), 1, 'numbers, not text')
	assert.equal(order('1.0.0', '0.99.99'), 1)
	assert.equal(order('1.0', '1.0.0'), 0)
	assert.equal(order('v0.5.0', '0.4.9'), 1)
	assert.equal(order('0.5.0-beta.1', '0.5.0'), -1, 'a release is newer than its prerelease')
	assert.equal(order('0.5.0-beta.2', '0.5.0-beta.10'), -1)
	assert.equal(order('0.5.0-beta.1', '0.4.9'), 1)
	assert.equal(compareVersions('latest', '0.4.1'), undefined)
	assert.equal(compareVersions('0.4.1', ''), undefined)
})

test('an update file is an update only when it is newer than the app', () => {
	assert.equal(parseAxleUpdate(update('0.4.2'), '0.4.1').productVersion, '0.4.2')
	assert.equal(parseAxleUpdate(update('0.4.1'), '0.4.1'), null, 'the same version')
	assert.equal(parseAxleUpdate(update('0.4.0'), '0.4.1'), null, 'an older release')
	assert.equal(parseAxleUpdate(update('0.5.0-rc.1'), '0.5.0'), null)
	assert.equal(parseAxleUpdate(update('banana'), '0.4.1'), null, 'not a version')
	assert.equal(parseAxleUpdate(update('0.4.2'), 'banana'), null, 'the app has no version to compare')
})

test('an incomplete or empty update file is no update', () => {
	for (const raw of [null, undefined, 'x', 7, {}, update('0.4.2', { url: '' }), update('0.4.2', { version: undefined }), update('0.4.2', { productVersion: undefined })]) {
		assert.equal(parseAxleUpdate(raw, '0.4.1'), null)
	}
})

const hashes = Object.fromEntries(platforms('0.4.2').map(({ asset }, i) => [asset, String(i).repeat(64)]))

test('the release job writes one update file per platform in the shape VS Code reads', () => {
	const files = buildManifests({ version: '0.4.2', commit: 'deadbeef', repo: 'bothuany/axle', hashes, timestamp: 1234 })
	assert.deepEqual(Object.keys(files).sort(), [
		`update-darwin-arm64-${QUALITY}.json`,
		`update-darwin-${QUALITY}.json`,
		`update-linux-x64-${QUALITY}.json`,
		`update-win32-x64-user-${QUALITY}.json`,
	].sort())
	for (const json of Object.values(files)) {
		assert.deepEqual(Object.keys(json).sort(), ['name', 'productVersion', 'sha256hash', 'timestamp', 'url', 'version'])
		assert.equal(json.productVersion, '0.4.2')
		assert.equal(json.version, 'deadbeef')
		assert.equal(json.timestamp, 1234)
		assert.match(json.sha256hash, /^[0-9]{64}$/)
		assert.equal(parseAxleUpdate(json, '0.4.1').productVersion, '0.4.2')
		assert.equal(parseAxleUpdate(json, '0.4.2'), null)
	}
	const win = files[`update-win32-x64-user-${QUALITY}.json`]
	assert.equal(win.url, 'https://github.com/bothuany/axle/releases/download/v0.4.2/Axle-Setup-0.4.2-x64.exe')
	assert.equal(win.sha256hash, hashes['Axle-Setup-0.4.2-x64.exe'])
	// macOS and Linux are not updated in place: the button opens the release page.
	for (const name of [`update-darwin-${QUALITY}.json`, `update-darwin-arm64-${QUALITY}.json`, `update-linux-x64-${QUALITY}.json`]) {
		assert.equal(files[name].url, 'https://github.com/bothuany/axle/releases/tag/v0.4.2')
	}
	assert.equal(files[`update-darwin-arm64-${QUALITY}.json`].sha256hash, hashes['Axle-0.4.2-darwin-arm64.zip'])
	assert.equal(files[`update-linux-x64-${QUALITY}.json`].sha256hash, hashes['axle_0.4.2_amd64.deb'])
})

test('a release with a missing file, or a bad version, writes nothing', () => {
	const { 'axle_0.4.2_amd64.deb': _deb, ...partial } = hashes
	assert.throws(() => buildManifests({ version: '0.4.2', commit: 'c', repo: 'o/r', hashes: partial, timestamp: 1 }), /axle_0\.4\.2_amd64\.deb is missing/)
	assert.throws(() => buildManifests({ version: 'v0.4.2', commit: 'c', repo: 'o/r', hashes, timestamp: 1 }), /not a version/)
})

test('the product points at the release assets with a quality the build has no other meaning for', () => {
	const product = addedLines('product.json', corePatch).join('\n')
	assert.match(product, new RegExp(`"quality": "${QUALITY}"`))
	assert.match(product, /"updateUrl": "https:\/\/github\.com\/bothuany\/axle\/releases\/latest\/download"/)
	// "stable" and "insider" switch on VS Code's own installer parts (the Windows 11 context menu) and a "switch to Insiders" prompt.
	assert.notEqual(QUALITY, 'stable')
	assert.notEqual(QUALITY, 'insider')
})

test('every update file name is the one the app asks for', () => {
	// The app asks for <updateUrl>/update-<platform>-<quality>.json, the platform being VS Code's own name for it.
	const asked = ['win32-x64-user', 'darwin', 'darwin-arm64', 'linux-x64'].map(p => `update-${p}-${QUALITY}.json`)
	assert.deepEqual(Object.keys(buildManifests({ version: '1.0.0', commit: 'c', repo: 'o/r', hashes: Object.fromEntries(platforms('1.0.0').map(({ asset }) => [asset, 'a'.repeat(64)])), timestamp: 1 })).sort(), asked.sort())
	for (const platform of ['win32-x64-user', 'darwin', 'darwin-arm64', 'linux-x64']) {
		assert.equal(createAxleUpdateURL(BASE, platform, QUALITY), `${BASE}/update-${platform}-${QUALITY}.json`)
	}
})

test('a local server of update files, named by AXLE_UPDATE_URL, tells an older app about the new release', async () => {
	const { createServer } = await import('node:http')
	const files = buildManifests({ version: '0.4.2', commit: 'c0ffee', repo: 'bothuany/axle', hashes, timestamp: 1 })
	const server = createServer((req, res) => {
		const json = files[decodeURIComponent((req.url ?? '').slice(1))]
		res.writeHead(json ? 200 : 404, { 'content-type': 'application/json' })
		res.end(json ? JSON.stringify(json) : '')
	})
	await new Promise(done => server.listen(0, '127.0.0.1', done))
	try {
		const base = resolveAxleUpdateBaseUrl(BASE, `http://127.0.0.1:${server.address().port}`)
		const url = createAxleUpdateURL(base, 'win32-x64-user', QUALITY)
		const found = parseAxleUpdate(await (await fetch(url)).json(), '0.4.1')
		assert.equal(found?.productVersion, '0.4.2')
		assert.match(found.url, /Axle-Setup-0\.4\.2-x64\.exe$/)
		assert.equal(parseAxleUpdate(await (await fetch(url)).json(), '0.4.2'), null, 'an app on the newest version is told nothing')
		assert.equal((await fetch(createAxleUpdateURL(base, 'win32-arm64-user', QUALITY))).status, 404)
	} finally {
		server.close()
	}
})

test('no two patches change the same file, so each one can be checked on its own', () => {
	const owner = new Map()
	for (const name of readdirSync(join(ROOT, 'editor', 'patches')).filter(f => f.endsWith('.patch'))) {
		for (const [, file] of readPatch(name).matchAll(/^diff --git a\/(\S+) /gm)) {
			assert.ok(!owner.has(file), `${file} is in both ${owner.get(file)} and ${name}`)
			owner.set(file, name)
		}
	}
})
