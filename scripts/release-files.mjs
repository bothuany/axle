// What a release carries, put together from the build jobs' artifacts (.github/workflows/release.yml, the assemble job):
//
//   node scripts/release-files.mjs --artifacts <folder> --out <folder> --version 0.5.2 --commit <sha> --repo bothuany/insilode
//
// <folder> holds one subfolder per build artifact (actions/download-artifact without merge-multiple), named as ARTIFACTS says.
// Each platform's files are taken only from its own artifact, and an artifact that is missing, lacks a file or holds a file
// nobody asked for stops the release: a same-named file from another job can never stand in for the real one.
// It writes into --out: every release file, SHA256SUMS.txt over them (what packaging/homebrew and packaging/winget take), and,
// for a release that is not a prerelease, the update files a running Insilode reads (scripts/update-manifests.mjs).
// A prerelease (1.2.3-rc.1) gets no update files: it is never "latest", and an installed Insilode must not update to it.
//
// It also maps a version to what the Linux packages can hold (scripts/package.mjs): see debVersion and rpmVersion.
import { createHash } from 'node:crypto'
import { copyFileSync, createReadStream, existsSync, mkdirSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { buildManifests } from './update-manifests.mjs'

const SEMVER = /^(\d+\.\d+\.\d+)(?:-([0-9A-Za-z.-]+))?$/

function parse(version) {
	const m = SEMVER.exec(version)
	if (!m) {
		throw new Error(`"${version}" is not a version like 1.2.3 or 1.2.3-rc.1`)
	}
	return { release: m[1], pre: m[2] }
}

/** A version with a prerelease part (1.2.3-rc.1): published as a GitHub prerelease, never as the latest release. */
export function isPrerelease(version) {
	return parse(version).pre !== undefined
}

/** The Debian Version field: 1.2.3-rc.1 becomes 1.2.3~rc.1, which dpkg sorts before 1.2.3 (a "-" would make rc.1 a revision of 1.2.3, sorted after it). */
export function debVersion(version) {
	const { release, pre } = parse(version)
	return pre === undefined ? release : `${release}~${pre.replace(/-/g, '.')}`
}

/** The RPM Version and Release fields: Version cannot hold a "-", so 1.2.3-rc.1 is Version 1.2.3, Release 0.rc.1 (before the release's Release 1). */
export function rpmVersion(version) {
	const { release, pre } = parse(version)
	return pre === undefined ? { version: release, release: '1' } : { version: release, release: `0.${pre.replace(/-/g, '.')}` }
}

/** The build artifacts of a release and the files each must hold: `optional` ones may be missing (the RPM is best effort). */
export function artifacts(version) {
	return {
		'insilode-win32-x64': { required: [`Insilode-Setup-${version}-x64.exe`], optional: [] },
		'insilode-darwin-arm64': { required: [`Insilode-${version}-darwin-arm64.zip`, `Insilode-${version}-darwin-arm64.dmg`], optional: [] },
		'insilode-darwin-x64': { required: [`Insilode-${version}-darwin-x64.zip`, `Insilode-${version}-darwin-x64.dmg`], optional: [] },
		'insilode-linux-x64': { required: [`insilode_${version}_amd64.deb`, `Insilode-${version}-linux-x64.tar.gz`], optional: [`insilode-${version}-1.x86_64.rpm`] },
	}
}

/**
 * Checks the downloaded artifacts against `artifacts(version)`. Returns the release files as `[{ name, path }]`, or throws with
 * every problem at once.
 */
export function collect(dir, version) {
	const problems = []
	const files = []
	const expected = artifacts(version)
	for (const [artifact, { required, optional }] of Object.entries(expected)) {
		const folder = join(dir, artifact)
		if (!existsSync(folder)) {
			problems.push(`the artifact ${artifact} is missing`)
			continue
		}
		const present = readdirSync(folder).filter(name => statSync(join(folder, name)).isFile())
		for (const name of required) {
			if (!present.includes(name)) {
				problems.push(`${artifact} has no ${name}`)
			}
		}
		for (const name of present) {
			if (required.includes(name) || optional.includes(name)) {
				files.push({ name, path: join(folder, name) })
			} else {
				problems.push(`${artifact} holds ${name}, which is not a release file of ${version}`)
			}
		}
	}
	for (const name of readdirSync(dir)) {
		if (!(name in expected)) {
			problems.push(`an artifact nobody asked for: ${name}`)
		}
	}
	if (problems.length) {
		throw new Error(`The build artifacts are not a whole release:\n  - ${problems.join('\n  - ')}`)
	}
	return files.sort((a, b) => (a.name < b.name ? -1 : 1))
}

function sha256(file) {
	return new Promise((done, fail) => {
		const hash = createHash('sha256')
		createReadStream(file).on('data', chunk => hash.update(chunk)).on('error', fail).on('end', () => done(hash.digest('hex')))
	})
}

/** Writes the release into `out`; returns the names of what it wrote. */
export async function assemble({ artifactsDir, out, version, commit, repo, timestamp = Date.now() }) {
	const files = collect(artifactsDir, version)
	mkdirSync(out, { recursive: true })
	const hashes = {}
	for (const f of files) {
		hashes[f.name] = await sha256(f.path)
		copyFileSync(f.path, join(out, f.name))
	}
	const written = files.map(f => f.name)
	writeFileSync(join(out, 'SHA256SUMS.txt'), files.map(f => `${hashes[f.name]}  ${f.name}\n`).join(''))
	written.push('SHA256SUMS.txt')
	if (!isPrerelease(version)) {
		for (const [name, json] of Object.entries(buildManifests({ version, commit, repo, hashes, timestamp }))) {
			writeFileSync(join(out, name), JSON.stringify(json, null, '\t') + '\n')
			written.push(name)
		}
	}
	return written
}

async function main() {
	const args = Object.fromEntries(process.argv.slice(2).reduce((pairs, arg, i, all) => (arg.startsWith('--') ? [...pairs, [arg.slice(2), all[i + 1]]] : pairs), []))
	for (const key of ['artifacts', 'out', 'version', 'commit', 'repo']) {
		if (!args[key]) {
			throw new Error(`--${key} is required`)
		}
	}
	const written = await assemble({ artifactsDir: resolve(args.artifacts), out: resolve(args.out), version: args.version, commit: args.commit, repo: args.repo })
	console.log(`Insilode ${args.version}${isPrerelease(args.version) ? ' (a prerelease: no update files)' : ''}:`)
	for (const name of written) {
		console.log(`  ${name}`)
	}
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
	main().catch(err => {
		console.error(err.message)
		process.exit(1)
	})
}
