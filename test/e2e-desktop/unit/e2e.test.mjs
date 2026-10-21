// The parts of the desktop e2e harness that need no window and no Playwright: the sandbox configuration, the safety guard,
// the installer command lines and the result table. Runs anywhere (`npm run test:e2e-unit`); the windows themselves only run
// in Docker or in Windows Sandbox.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { SANDBOX_IN, SANDBOX_OUT, buildWsb, logonCommand, missingSandboxMessage, sandboxExe, summarize } from '../../../scripts/sandbox-config.mjs'
import { newestInstaller } from '../../../scripts/sandbox-e2e.mjs'
import { refusal } from '../lib/isolation.mjs'
import { pointerCommand } from '../lib/pointer.mjs'
import { Results } from '../lib/results.mjs'
import { installArgs, updateManifest } from '../lib/installer.mjs'
import { parseArgs, sourceElectron } from '../run.mjs'

test('the .wsb maps the inputs read-only, the output read-write, and has no network', () => {
	const wsb = buildWsb({ inputDir: 'C:\\Temp\\axle-in', outputDir: 'C:\\Temp\\axle-out' })
	const folders = [...wsb.matchAll(/<MappedFolder>\s*<HostFolder>(.*?)<\/HostFolder>\s*<SandboxFolder>(.*?)<\/SandboxFolder>\s*<ReadOnly>(.*?)<\/ReadOnly>/g)].map(m => m.slice(1))
	assert.deepEqual(folders, [['C:\\Temp\\axle-in', SANDBOX_IN, 'true'], ['C:\\Temp\\axle-out', SANDBOX_OUT, 'false']])
	assert.match(wsb, /<Networking>Disable<\/Networking>/)
	assert.match(wsb, /<ClipboardRedirection>Disable<\/ClipboardRedirection>/)
	assert.match(wsb, /<LogonCommand>\s*<Command>.*run-in-sandbox\.ps1.*-Shutdown.*<\/Command>/)
})

test('the .wsb keeps networking only when asked, and escapes what is put into the XML', () => {
	assert.match(buildWsb({ inputDir: 'C:\\a&b', outputDir: 'C:\\o<1>', networking: true }), /<Networking>Default<\/Networking>/)
	const wsb = buildWsb({ inputDir: 'C:\\a&b', outputDir: 'C:\\o"<1>' })
	assert.match(wsb, /C:\\a&amp;b/)
	assert.match(wsb, /C:\\o&quot;&lt;1&gt;/)
	assert.doesNotMatch(wsb, /a&b/)
})

test('the .wsb refuses a missing folder and a read-only input that is also the output', () => {
	assert.throws(() => buildWsb({ inputDir: 'C:\\a' }), /outputDir/)
	assert.throws(() => buildWsb({ inputDir: 'C:\\a', outputDir: 'C:\\a' }), /different/)
})

test('the logon command runs the in-sandbox script with the mapped folders', () => {
	const cmd = logonCommand()
	assert.match(cmd, /^powershell\.exe -NoProfile -ExecutionPolicy Bypass -File "C:\\axle-e2e\\in\\repo\\test\\e2e-desktop\\sandbox\\run-in-sandbox\.ps1"/)
	assert.match(cmd, /-In "C:\\axle-e2e\\in" -Out "C:\\axle-e2e\\out" -Shutdown$/)
	assert.doesNotMatch(logonCommand({ shutdown: false }), /-Shutdown/)
})

test('a machine without Windows Sandbox is told how to turn it on', () => {
	assert.equal(sandboxExe({ SystemRoot: 'D:\\Win' }), 'D:\\Win\\System32\\WindowsSandbox.exe')
	const message = missingSandboxMessage('C:\\Windows\\System32\\WindowsSandbox.exe')
	assert.match(message, /WindowsSandbox\.exe does not exist/)
	assert.match(message, /Containers-DisposableClientVM/)
	assert.match(message, /Restart/)
	assert.match(message, /docker:e2e/)
})

test('the summary lists every scenario and the screenshots by their host path', () => {
	const text = summarize({ label: 'sandbox', scenarios: [{ title: 'A', status: 'pass', shots: ['shots/a.png'] }, { title: 'B', status: 'fail', detail: 'boom', shots: [] }] }, 'C:\\out')
	assert.match(text, /1 of 2 scenarios did not fail/)
	assert.match(text, /FAIL {2}B\n {8}boom/)
	assert.match(text, /C:\\out\\shots\\a\.png/)
})

test('newestInstaller picks the newest Setup and ignores other files', () => {
	const dir = mkdtempSync(join(tmpdir(), 'axle-dist-'))
	try {
		assert.equal(newestInstaller(join(dir, 'missing')), undefined)
		writeFileSync(join(dir, 'Axle-Setup-0.4.2-x64.exe'), '')
		writeFileSync(join(dir, 'notes.txt'), '')
		assert.equal(newestInstaller(dir), join(dir, 'Axle-Setup-0.4.2-x64.exe'))
	} finally {
		rmSync(dir, { recursive: true, force: true })
	}
})

test('without AXLE_E2E_ISOLATED nothing opens a window, and the message says where the tests run', () => {
	assert.match(refusal({}), /Refusing to open Axle windows/)
	assert.match(refusal({ AXLE_E2E_ISOLATED: '0' }), /docker:e2e/)
	assert.equal(refusal({ AXLE_E2E_ISOLATED: '1' }), '')
})

test('the pointer is moved with SetCursorPos on Windows, xdotool on Linux and not at all on a Mac', () => {
	assert.match(pointerCommand('win32', 10.4, 20.6)[1].join(' '), /SetCursorPos\(10, 21\)/)
	assert.deepEqual(pointerCommand('linux', 5, 6), ['xdotool', ['mousemove', '5', '6']])
	assert.equal(pointerCommand('darwin', 1, 2), undefined)
})

test('the silent install has no dialogs, no restart and does not launch Axle', () => {
	const args = installArgs('C:\\Temp\\Axle', 'C:\\Temp\\setup.log')
	for (const a of ['/VERYSILENT', '/SUPPRESSMSGBOXES', '/NORESTART', '/DIR=C:\\Temp\\Axle', '/LOG=C:\\Temp\\setup.log', '/MERGETASKS=!runcode']) {
		assert.ok(args.includes(a), a)
	}
})

test('the update file is the one the app reads: a newer productVersion and a url on the local server', () => {
	const m = updateManifest({ url: 'http://127.0.0.1:8123', file: 'C:\\x\\Axle-Setup-0.4.3-x64.exe', version: '0.4.3', sha256hash: 'ab', timestamp: 1 })
	assert.deepEqual(m, { url: 'http://127.0.0.1:8123/Axle-Setup-0.4.3-x64.exe', name: 'Axle 0.4.3', version: 'e2e-update-commit', productVersion: '0.4.3', sha256hash: 'ab', timestamp: 1 })
})

test('results are recorded as they come and a failure is remembered', () => {
	const dir = mkdtempSync(join(tmpdir(), 'axle-results-'))
	try {
		const r = new Results('docker', join(dir, 'o'))
		r.add({ title: 'One', status: 'pass', detail: 'fine' })
		assert.equal(r.failed, false)
		r.add({ title: 'Two', status: 'fail', detail: 'boom' })
		assert.equal(r.failed, true)
		assert.deepEqual(JSON.parse(readFileSync(join(dir, 'o', 'results.json'), 'utf8')).scenarios.map(s => s.status), ['pass', 'fail'])
	} finally {
		rmSync(dir, { recursive: true, force: true })
	}
})

test('run.mjs reads its options and finds the Electron binary of a source checkout', () => {
	assert.deepEqual(parseArgs(['--label', 'linux', '--only', 'island', '--flag']), { label: 'linux', only: 'island', flag: true })
	assert.throws(() => parseArgs(['stray']), /Unexpected argument/)
	const dir = mkdtempSync(join(tmpdir(), 'axle-src-'))
	try {
		writeFileSync(join(dir, 'product.json'), JSON.stringify({ nameShort: 'Axle', applicationName: 'axle' }))
		assert.throws(() => sourceElectron(dir), /No Electron binary/)
		mkdirSync(join(dir, '.build', 'electron'), { recursive: true })
		const bin = process.platform === 'win32' ? 'Axle.exe' : 'axle'
		writeFileSync(join(dir, '.build', 'electron', bin), '')
		assert.equal(sourceElectron(dir), join(dir, '.build', 'electron', bin))
	} finally {
		rmSync(dir, { recursive: true, force: true })
	}
})

test('the Docker run shares nothing of the host screen, network or input, and maps the repository read-only', async () => {
	const { dockerRunArgs, imageTag, dockerMissingMessage, WORK_VOLUME } = await import('../../../scripts/docker-config.mjs')
	const args = dockerRunArgs({ image: 'axle-e2e:x', name: 'n', repo: 'C:\repo', ctl: 'C:\ctl', out: 'C:\out', mode: 'run', modeArgs: ['--only', 'island'] })
	const line = args.join(' ')
	assert.ok(!args.includes('-p') && !args.includes('--publish') && !/--network|--net\b|--pid|--ipc|--privileged/.test(line), line)
	assert.doesNotMatch(line, /X11|DISPLAY|\/dev\/|\.Xauthority/)
	assert.deepEqual(args.filter((a, i) => args[i - 1] === '-v'), [`${WORK_VOLUME}:/work/axle`, 'C:\repo:/src:ro', 'C:\ctl:/ctl:ro', 'C:\out:/out'])
	// The isolation switch is set by the entrypoint inside the container, never passed in from the host's environment.
	assert.ok(!args.includes('-e') && !args.includes('--env'))
	assert.deepEqual(args.slice(-4), ['axle-e2e:x', 'run', '--only', 'island'])
	assert.ok(dockerRunArgs({ image: 'i', name: 'n', repo: 'r', ctl: 'c', out: 'o', probeDir: 'C:\p', mode: 'probe', modeArgs: ['a.mjs'] }).includes('C:\p:/probe:ro'))
	assert.notEqual(imageTag('a', 'b'), imageTag('a', 'c'))
	assert.match(dockerMissingMessage('no daemon'), /Docker Desktop[\s\S]*sandbox:e2e/)
})

test('the container entrypoint sets the isolation switch itself and the host launcher never does', async () => {
	const { readFileSync } = await import('node:fs')
	const entry = readFileSync(new URL('../docker/entrypoint.sh', import.meta.url), 'utf8')
	assert.match(entry, /export AXLE_E2E_ISOLATED=1/)
	assert.doesNotMatch(readFileSync(new URL('../../../scripts/docker-e2e.mjs', import.meta.url), 'utf8'), /AXLE_E2E_ISOLATED\s*[=:]/)
})
