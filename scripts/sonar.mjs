// Local SonarQube: a server in Docker (tools/sonarqube/compose.yml) and a scan of this checkout against it.
//   npm run sonar:up            start the server on http://localhost:9000 and wait until it is up
//   npm run sonar               scan the TypeScript/JavaScript side (project `axle`, sonar-project.properties)
//   npm run sonar -- --dotnet   also scan the C# analyzer (project `axle-analyzer`, needs the .NET SDK)
//   npm run sonar:down          stop the server (its data stays in Docker volumes)
// The scan needs a token: SONAR_TOKEN, or the first line of tools/sonarqube/.token (git-ignored).
import { existsSync, readFileSync } from 'fs'
import { join } from 'path'
import { ROOT, launchSync } from './lib.mjs'

const COMPOSE = ['compose', '-f', join(ROOT, 'tools', 'sonarqube', 'compose.yml')]
const NETWORK = 'axle-sonarqube_default'
const SCANNER = 'sonarsource/sonar-scanner-cli:12.2.0.4256_8.1.0'
const HOST = 'http://localhost:9000'

const run = (cmd, args, options = {}) => {
	const r = launchSync(cmd, args, { cwd: ROOT, stdio: 'inherit', windowsHide: true, ...options })
	if (r.status !== 0) {
		process.exit(r.status ?? 1)
	}
}

function token() {
	const file = join(ROOT, 'tools', 'sonarqube', '.token')
	const t = process.env.SONAR_TOKEN || (existsSync(file) ? readFileSync(file, 'utf8').split(/\r?\n/)[0].trim() : '')
	if (!t) {
		console.error(`No SonarQube token. Open ${HOST} (first login admin/admin, then set a new password), create a token under`
			+ ' My Account > Security, and put it in SONAR_TOKEN or tools/sonarqube/.token.')
		process.exit(1)
	}
	return t
}

const [command = 'scan', ...rest] = process.argv.slice(2).filter(a => !a.startsWith('--'))
const flags = new Set(process.argv.slice(2).filter(a => a.startsWith('--')))

if (command === 'up') {
	run('docker', [...COMPOSE, 'up', '-d', '--wait'])
	console.log(`SonarQube is up: ${HOST}`)
} else if (command === 'down') {
	run('docker', [...COMPOSE, 'stop'])
} else if (command === 'scan' && rest.length === 0) {
	const t = token()
	// The scanner runs in the server's compose network; the token goes in through the environment, not the command line.
	run('docker', ['run', '--rm', '--network', NETWORK, '-e', 'SONAR_TOKEN', '-e', 'SONAR_HOST_URL=http://sonarqube:9000',
		'-v', `${ROOT}:/usr/src`, SCANNER], { env: { ...process.env, SONAR_TOKEN: t } })
	if (flags.has('--dotnet')) {
		// dotnet-sonarscanner only takes the token as an argument; it is visible in this machine's process list while it runs.
		run('dotnet', ['tool', 'restore'])
		run('dotnet', ['dotnet-sonarscanner', 'begin', '/k:axle-analyzer', '/n:Axle analyzer', `/d:sonar.host.url=${HOST}`, '/d:sonar.token=' + t])
		run('dotnet', ['build', 'analyzer', '-nologo', '-v', 'q', '--no-incremental'])
		run('dotnet', ['dotnet-sonarscanner', 'end', '/d:sonar.token=' + t])
	}
	console.log(`Results: ${HOST}/dashboard?id=axle`)
} else {
	console.error('usage: node scripts/sonar.mjs [up | down | scan [--dotnet]]')
	process.exit(2)
}
