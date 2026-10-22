// Runs Semgrep the same way locally and in CI: the registry rulesets for the languages Insilode is written in, plus
// .semgrep/rules (Insilode's own).
//   npm run semgrep              findings as text
//   npm run semgrep -- <args>    extra arguments go to `semgrep scan`
// ERROR findings fail the run; WARNING findings are printed but do not. Files git does not track yet are scanned too
// (.semgrepignore pulls in .gitignore). Uses `semgrep` from PATH (`uv tool install semgrep`), else the pinned
// semgrep/semgrep Docker image.
import { mkdtempSync, readFileSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { ROOT, launchSync } from './lib.mjs'

const IMAGE = 'semgrep/semgrep:1.181.0'
const CONFIGS = ['p/typescript', 'p/javascript', 'p/react', 'p/nodejs', 'p/csharp', 'p/secrets', 'p/github-actions', '.semgrep/rules']

const out = mkdtempSync(join(tmpdir(), 'insilode-semgrep-'))
const local = launchSync('semgrep', ['--version'], { windowsHide: true }).status === 0
const json = local ? join(out, 'results.json') : '/out/results.json'
const args = ['scan', '--metrics=off', '--no-git-ignore', `--json-output=${json}`, ...CONFIGS.flatMap(c => ['--config', c]), ...process.argv.slice(2)]

const run = local
	? launchSync('semgrep', args, { cwd: ROOT, stdio: 'inherit', windowsHide: true })
	: launchSync('docker', ['run', '--rm', '-v', `${ROOT}:/src`, '-v', `${out}:/out`, '-w', '/src', IMAGE, 'semgrep', ...args], { stdio: 'inherit', windowsHide: true })

// The JSON decides: semgrep also exits non-zero for files it could only partly parse, which is not a finding.
let code = 1
try {
	const { results = [], errors = [] } = JSON.parse(readFileSync(join(out, 'results.json'), 'utf8'))
	const blocking = results.filter(r => r.extra?.severity === 'ERROR')
	console.log(`\nsemgrep: ${blocking.length} blocking (ERROR), ${results.length - blocking.length} advisory; ${errors.length} files only partly parsed`)
	code = blocking.length === 0 ? 0 : 1
} catch {
	console.error(`semgrep produced no results (exit ${run.status}).`)
} finally {
	rmSync(out, { recursive: true, force: true })
}
process.exit(code)
