// What the core patch (editor/patches/flow-core.patch) makes the web server tell the browser client, and the setup step
// that puts the icon font where the compiled workbench loads it. Both broke `npm run web` on a fresh checkout.
import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { codiconFontPaths, ensureCodiconFont } from '../../scripts/lib.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const corePatch = readFileSync(join(ROOT, 'editor', 'patches', 'flow-core.patch'), 'utf8').replace(/\r\n/g, '\n')

/** The lines of one file's section of the core patch that start with `sign` ('+' added, '-' removed), without it. */
function lines(file, sign) {
	const section = corePatch.split(/^diff --git /m).find(part => part.startsWith(`a/${file} `))
	assert.ok(section, `${file} is not in the core patch`)
	const body = section.split('\n')
	return body.slice(body.findIndex(line => line.startsWith('@@'))).filter(line => line.startsWith(sign)).map(line => line.slice(1))
}

/** VS Code's own rule for the path segment of server resources (src/vs/base/common/network.ts, getServerProductSegment). */
const productSegment = product => `${product.quality ?? 'oss'}-${product.commit ?? 'dev'}`

test('the web server sends its own quality to the client, so both use one resource path', () => {
	const server = 'src/vs/server/node/webClientServer.ts'
	const sent = lines(server, '+').find(line => /^\s*productConfiguration:/.test(line))
	assert.ok(sent, 'the patch does not change the productConfiguration the server sends to the browser')
	// Last in the object, so that product.overrides.json (which a source checkout merges in) cannot set another quality.
	assert.match(sent, /^\s*productConfiguration: \{ \.\.\.productConfiguration, quality: this\._productService\.quality \},$/)
	assert.ok(lines(server, '-').some(line => line.trim() === 'productConfiguration,'), 'the original shorthand is replaced, not sent twice')

	// The quality the server answers under is Insilode's (product.json, also in the core patch), and a client that is
	// sent it asks for the same segment; without it, a client running out of sources asked /oss-dev/ and got a 404.
	const product = JSON.parse(`{${lines('product.json', '+').find(line => /"quality"/.test(line)).replace(/,\s*$/, '')}}`)
	assert.equal(product.quality, 'insilode')
	assert.equal(productSegment({ quality: product.quality }), 'insilode-dev')
	assert.equal(productSegment({}), 'oss-dev', 'what a source client without the server\'s quality asked for')
})

test('setup builds the icon font into src/ before transpile-client copies src/ to out/', () => {
	const setup = readFileSync(join(ROOT, 'scripts', 'setup.mjs'), 'utf8')
	const fonts = setup.indexOf("run('npm', ['run', 'build-fast-extensions']")
	const transpile = setup.indexOf("run('npm', ['run', 'transpile-client']")
	assert.ok(fonts > 0 && transpile > 0, 'setup runs both steps')
	assert.ok(fonts < transpile, 'build-fast-extensions (gulp copy-codicons) has to run before transpile-client')
	assert.ok(setup.indexOf('ensureCodiconFont()', transpile) > transpile, 'and setup checks the font reached out/')
})

test('the icon font is copied into out/ when a build left it out, and said missing when there is none', () => {
	const dir = mkdtempSync(join(realpathSync.native(tmpdir()), 'insilode-codicon-'))
	try {
		const { packaged, src, out } = codiconFontPaths(dir)
		assert.equal(ensureCodiconFont(dir), 'missing')
		mkdirSync(dirname(packaged), { recursive: true })
		writeFileSync(packaged, 'npm')
		assert.equal(ensureCodiconFont(dir), 'copied')
		assert.equal(readFileSync(out, 'utf8'), 'npm')
		assert.equal(ensureCodiconFont(dir), 'present')

		// src/ wins over the npm package: it is what `gulp copy-codicons` (and VS Code's own build) put there.
		rmSync(out)
		mkdirSync(dirname(src), { recursive: true })
		writeFileSync(src, 'src')
		assert.equal(ensureCodiconFont(dir), 'copied')
		assert.equal(readFileSync(out, 'utf8'), 'src')
		assert.ok(existsSync(out))
	} finally {
		rmSync(dir, { recursive: true, force: true })
	}
})
