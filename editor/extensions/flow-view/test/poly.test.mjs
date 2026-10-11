// What the index finds in each fixture project must not change by accident.
// After an intended change: UPDATE=1 npm test, then read the diff of test/expected. A fixture without an expected file fails until then.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { ROOT, describe } from './helpers.mjs'

const fixtures = readdirSync(join(ROOT, 'test', 'fixtures')).filter(d => !d.startsWith('hybrid'))
if (process.env.UPDATE) {
	mkdirSync(join(ROOT, 'test', 'expected'), { recursive: true })
}

for (const name of fixtures) {
	test(`index: ${name}`, async () => {
		const actual = await describe(join(ROOT, 'test', 'fixtures', name))
		const file = join(ROOT, 'test', 'expected', `${name}.txt`)
		if (process.env.UPDATE) {
			writeFileSync(file, actual)
			return
		}
		assert.ok(existsSync(file), `no snapshot for ${name}: run UPDATE=1 npm test, read test/expected/${name}.txt, then commit it`)
		assert.equal(actual, readFileSync(file, 'utf8'))
	})
}
