// What scripts/sandbox-e2e.mjs needs to know about Windows Sandbox, without touching the machine: the .wsb file, the logon
// command, and what to tell a person whose machine cannot run it. Pure, so test/e2e-desktop/unit tests it anywhere.

/** Where the mapped folders appear inside the sandbox. */
export const SANDBOX_IN = 'C:\\insilode-e2e\\in'
export const SANDBOX_OUT = 'C:\\insilode-e2e\\out'

const xml = text => String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

/** The command Windows Sandbox runs when the desktop is up: the in-sandbox script, then shutdown. */
export function logonCommand({ shutdown = true } = {}) {
	const script = `${SANDBOX_IN}\\repo\\test\\e2e-desktop\\sandbox\\run-in-sandbox.ps1`
	return `powershell.exe -NoProfile -ExecutionPolicy Bypass -File "${script}" -In "${SANDBOX_IN}" -Out "${SANDBOX_OUT}"${shutdown ? ' -Shutdown' : ''}`
}

/**
 * The .wsb configuration. The staged inputs (installer, test code, node.exe) are mapped read-only and the output folder
 * read-write, so a failed or hostile run cannot change the host beyond that one folder. Networking is off: nothing in the
 * scenarios needs it (the update server is on the sandbox's own loopback), so the build under test cannot reach out.
 * Clipboard, audio, video, printers and the GPU are off for the same reason: nothing needs them.
 */
export function buildWsb({ inputDir, outputDir, networking = false, memoryMB = 6144 }) {
	if (!inputDir || !outputDir) {
		throw new Error('buildWsb needs an inputDir and an outputDir')
	}
	if (inputDir === outputDir) {
		throw new Error('The input folder is read-only and the output folder is not: they must be different folders')
	}
	const folder = (host, sandbox, readOnly) => `    <MappedFolder>
      <HostFolder>${xml(host)}</HostFolder>
      <SandboxFolder>${xml(sandbox)}</SandboxFolder>
      <ReadOnly>${readOnly}</ReadOnly>
    </MappedFolder>`
	return `<Configuration>
  <VGpu>Disable</VGpu>
  <Networking>${networking ? 'Default' : 'Disable'}</Networking>
  <AudioInput>Disable</AudioInput>
  <VideoInput>Disable</VideoInput>
  <PrinterRedirection>Disable</PrinterRedirection>
  <ClipboardRedirection>Disable</ClipboardRedirection>
  <MemoryInMB>${Math.round(memoryMB)}</MemoryInMB>
  <MappedFolders>
${folder(inputDir, SANDBOX_IN, true)}
${folder(outputDir, SANDBOX_OUT, false)}
  </MappedFolders>
  <LogonCommand>
    <Command>${xml(logonCommand())}</Command>
  </LogonCommand>
</Configuration>
`
}

/** Where Windows puts the sandbox launcher once the feature is on. */
export function sandboxExe(env = process.env) {
	return `${env.SystemRoot ?? env.windir ?? 'C:\\Windows'}\\System32\\WindowsSandbox.exe`
}

/** What to say when WindowsSandbox.exe is not there. */
export function missingSandboxMessage(exe) {
	return [
		`Windows Sandbox is not available: ${exe} does not exist.`,
		'Turn it on once (Windows 10/11 Pro, Enterprise or Education; Home does not have it):',
		'  1. Open "Turn Windows features on or off" (optionalfeatures.exe), tick "Windows Sandbox", OK;',
		'     or, in an administrator PowerShell: Enable-WindowsOptionalFeature -Online -FeatureName Containers-DisposableClientVM -All',
		'  2. Restart Windows when it asks. Virtualization must be enabled in the BIOS/UEFI.',
		'Then run this again. Until then the Linux scenarios run in Docker (npm run docker:e2e); desktop tests never run on your own desktop.',
	].join('\n')
}

/**
 * The sandbox's done.json, or undefined while it is not whole yet. run-in-sandbox.ps1 writes it with Windows PowerShell 5.1,
 * whose `Set-Content -Encoding utf8` starts the file with a byte order mark (JSON.parse rejects it), and the host can see the
 * file before the write has finished.
 */
export function parseDoneMarker(text) {
	try {
		return JSON.parse(String(text).replace(/^\uFEFF/, ''))
	} catch {
		return undefined
	}
}

/** A string as a single-quoted PowerShell literal: a ' in a path (C:\Users\O'Brien) would otherwise end it. */
export const psQuote = text => `'${String(text).replace(/'/g, "''")}'`

/** The summary the launcher prints from <out>/results.json. */
export function summarize(results, outDir) {
	const rows = results.scenarios.map(s => `  ${{ pass: 'PASS', fail: 'FAIL', skip: 'SKIP' }[s.status]}  ${s.title}${s.detail ? `\n        ${s.detail}` : ''}`)
	const shots = results.scenarios.flatMap(s => s.shots ?? []).map(f => `${outDir}\\${f.replace(/\//g, '\\')}`)
	const failed = results.scenarios.filter(s => s.status === 'fail').length
	return [`Sandbox run "${results.label}": ${results.scenarios.length - failed} of ${results.scenarios.length} scenarios did not fail.`, ...rows, '', 'Screenshots:', ...shots.map(s => `  ${s}`)].join('\n')
}
