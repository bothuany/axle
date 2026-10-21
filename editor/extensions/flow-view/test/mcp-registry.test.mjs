// How an MCP server finds the Insilode window of a folder: bridge files, stale cleanup, window matching, path checks.
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { cleanup, load, temp } from './bundle.mjs'

let r
before(async () => { r = await load('src/mcp/registry.ts') })
after(cleanup)

const info = (pid, folders, createdAt = 1) => ({ pid, port: 4000 + pid, token: 't'.repeat(8), workspaceFolders: folders, createdAt })

test('mcp-registry: the bridge dir can be redirected, so tests never see the real ~/.insilode', () => {
	assert.equal(r.bridgeDir({ INSILODE_BRIDGE_DIR: '/tmp/x' }), '/tmp/x')
	assert.match(r.bridgeDir({}), /\.insilode[\\/]bridge$/)
})

test('mcp-registry: paths compare by whole segments, case-insensitively on Windows', () => {
	assert.equal(r.isInside('C:\\Dev\\Foo', 'c:/dev/foo/src/a.cs', 'win32'), true)
	assert.equal(r.isInside('C:\\Dev\\Foo', 'C:\\Dev\\Foo', 'win32'), true)
	assert.equal(r.isInside('C:\\foo', 'C:\\foobar\\a.cs', 'win32'), false)
	assert.equal(r.isInside('/home/a/Foo', '/home/a/foo/x', 'linux'), false, 'Linux is case-sensitive')
	assert.equal(r.isInside('/home/a/foo', '/home/a/foo/x', 'linux'), true)
	assert.equal(r.isInside('C:\\foo\\', 'C:\\foo\\x', 'win32'), true, 'a trailing separator does not matter')
})

test('mcp-registry: the window with the longest matching folder wins, then the newest', () => {
	const bridges = [
		info(1, ['C:\\dev']),
		info(2, ['C:\\dev\\app'], 10),
		info(3, ['C:\\dev\\app'], 20),
		info(4, ['C:\\other']),
		info(5, ['C:\\dev\\app'], 99),
	]
	const alive = pid => pid !== 5
	const order = r.matchWindows(bridges, 'C:\\dev\\app\\src', alive, 'win32').map(b => b.pid)
	assert.deepEqual(order, [3, 2, 1], 'longest folder first, newest first among equals, the dead window and the unrelated one left out')
	assert.deepEqual(r.matchWindows(bridges, 'D:\\elsewhere', alive, 'win32'), [])
})

test('mcp-registry: a window with several folders matches through any of them', () => {
	const bridges = [info(7, ['/a', '/b/c'])]
	assert.equal(r.matchWindows(bridges, '/b/c/d', () => true, 'linux').length, 1)
	assert.equal(r.matchWindows(bridges, '/b', () => true, 'linux').length, 0)
})

test('mcp-registry: bridge files round-trip, damaged files are ignored', async () => {
	const dir = temp('insilode-bridge-')
	await r.writeBridgeFile(info(11, ['/x']), dir)
	writeFileSync(join(dir, '12.json'), '{not json')
	writeFileSync(join(dir, '13.json'), JSON.stringify({ pid: 99, port: 1, token: 'x', workspaceFolders: [] })) // pid does not match the name
	writeFileSync(join(dir, 'notes.txt'), 'hi')
	const all = await r.readBridges(dir)
	assert.deepEqual(all.map(b => b.pid), [11])
	assert.equal(JSON.parse(readFileSync(join(dir, '11.json'), 'utf8')).port, 4011)
	assert.deepEqual(await r.readBridges(join(dir, 'missing')), [])
})

test('mcp-registry: stale files of dead windows are removed, live ones and our own stay', async () => {
	const dir = temp('insilode-bridge-')
	for (const pid of [21, 22, 23]) {
		await r.writeBridgeFile(info(pid, ['/x']), dir)
	}
	const removed = await r.cleanStale(dir, pid => pid === 22, 23)
	assert.deepEqual(removed.sort(), [21])
	assert.equal(existsSync(join(dir, '21.json')), false)
	assert.equal(existsSync(join(dir, '22.json')), true)
	assert.equal(existsSync(join(dir, '23.json')), true, 'keepPid is never removed')
	await r.removeBridgeFile(22, dir)
	assert.equal(existsSync(join(dir, '22.json')), false)
	await r.removeBridgeFile(22, dir) // gone already: no error
})

test('mcp-registry: this very process counts as alive, a made-up pid does not', () => {
	assert.equal(r.isAlive(process.pid), true)
	assert.equal(r.isAlive(2 ** 22 - 3), false)
})

test('mcp-registry: only paths inside a workspace folder resolve', () => {
	const folders = ['C:\\dev\\app']
	assert.equal(r.resolveInWorkspace('src\\a.cs', folders, 'win32'), 'C:\\dev\\app\\src\\a.cs')
	assert.equal(r.resolveInWorkspace('C:\\dev\\app\\src\\a.cs', folders, 'win32'), 'C:\\dev\\app\\src\\a.cs')
	assert.equal(r.resolveInWorkspace('c:/dev/app/x.cs', folders, 'win32'), 'c:\\dev\\app\\x.cs')
	assert.equal(r.resolveInWorkspace('..\\secret.txt', folders, 'win32'), undefined, '.. escapes are refused')
	assert.equal(r.resolveInWorkspace('src\\..\\..\\secret.txt', folders, 'win32'), undefined)
	assert.equal(r.resolveInWorkspace('C:\\dev\\application\\x.cs', folders, 'win32'), undefined, 'a sibling that shares a prefix is outside')
	assert.equal(r.resolveInWorkspace('C:\\Windows\\win.ini', folders, 'win32'), undefined)
	assert.equal(r.resolveInWorkspace('\\\\server\\share\\x', folders, 'win32'), undefined)
	assert.equal(r.resolveInWorkspace('', folders, 'win32'), undefined)
	assert.equal(r.resolveInWorkspace('a\0b', folders, 'win32'), undefined)
	assert.equal(r.resolveInWorkspace('x', [], 'win32'), undefined)
	assert.equal(r.resolveInWorkspace('/etc/passwd', ['/home/a'], 'linux'), undefined)
	assert.equal(r.resolveInWorkspace('../b/x', ['/home/a'], 'linux'), undefined)
	assert.equal(r.resolveInWorkspace('src/x.ts', ['/home/a'], 'linux'), '/home/a/src/x.ts')
})
