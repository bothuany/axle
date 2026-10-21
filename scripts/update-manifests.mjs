// Writes the update files a release carries next to its installers: one update-<platform>-insilode.json per platform (and the same under the old name, update-<platform>-axle.json),
// which the update service of the Insilode app (editor/patches/flow-update.patch) reads from
// https://github.com/<repo>/releases/latest/download/. The app compares productVersion with its own version, so a
// release never needs a server to say "no update".
//
//   node scripts/update-manifests.mjs --dir <folder with the release files> --out <folder> --version 0.4.2 \
//     --commit <sha> --repo bothuany/insilode
//
// Per platform: the Windows file points at the per-user installer (it is downloaded and run silently); the macOS and
// Linux files point at the release page, because those apps are not updated in place (see packaging/README.md).
import { createHash } from 'node:crypto'
import { createReadStream, existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

/** Product `quality` of the app: part of every file name. Must equal "quality" in product.json (test/update checks it). */
export const QUALITY = 'insilode'

/**
 * The quality of the app before the rename (it was called Axle): an installed 0.4.x asks for `update-<platform>-axle.json`, at the same
 * releases/latest/download address (GitHub redirects a renamed repository). The same file is written under that name too, for the 0.5.x
 * releases, so those users are told of the new release. Drop it when the 0.4.x tail is gone.
 */
export const LEGACY_QUALITY = 'axle'

/** What each update file points at: the asset it is the checksum of and whether the app installs it itself. */
export function platforms(version) {
	return [
		{ platform: 'win32-x64-user', asset: `Insilode-Setup-${version}-x64.exe`, install: true },
		{ platform: 'darwin', asset: `Insilode-${version}-darwin-x64.zip`, install: false },
		{ platform: 'darwin-arm64', asset: `Insilode-${version}-darwin-arm64.zip`, install: false },
		{ platform: 'linux-x64', asset: `insilode_${version}_amd64.deb`, install: false },
	]
}

/**
 * The update files of a release, as `{ <file name>: <JSON object> }`. `hashes` maps an asset name to its sha256;
 * a platform whose asset is missing is an error, so that a release is never published with a hole in it.
 */
export function buildManifests({ version, commit, repo, hashes, timestamp }) {
	if (!/^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/.test(version)) {
		throw new Error(`"${version}" is not a version like 1.2.3`)
	}
	const tag = `v${version}`
	const files = {}
	for (const { platform, asset, install } of platforms(version)) {
		const sha256hash = hashes[asset]
		if (!sha256hash) {
			throw new Error(`${asset} is missing: the ${platform} update file cannot be written`)
		}
		const file = {
			url: install ? `https://github.com/${repo}/releases/download/${tag}/${asset}` : `https://github.com/${repo}/releases/tag/${tag}`,
			name: `Insilode ${version}`,
			version: commit,
			productVersion: version,
			sha256hash,
			timestamp,
		}
		for (const quality of [QUALITY, LEGACY_QUALITY]) {
			files[`update-${platform}-${quality}.json`] = file
		}
	}
	return files
}

function sha256(file) {
	return new Promise((done, fail) => {
		const hash = createHash('sha256')
		createReadStream(file).on('data', chunk => hash.update(chunk)).on('error', fail).on('end', () => done(hash.digest('hex')))
	})
}

async function main() {
	const args = Object.fromEntries(process.argv.slice(2).reduce((pairs, arg, i, all) => (arg.startsWith('--') ? [...pairs, [arg.slice(2), all[i + 1]]] : pairs), []))
	for (const key of ['dir', 'out', 'version', 'commit', 'repo']) {
		if (!args[key]) {
			throw new Error(`--${key} is required`)
		}
	}
	const hashes = {}
	for (const { asset } of platforms(args.version)) {
		const file = join(resolve(args.dir), asset)
		if (existsSync(file)) {
			hashes[asset] = await sha256(file)
		}
	}
	const files = buildManifests({ version: args.version, commit: args.commit, repo: args.repo, hashes, timestamp: Date.now() })
	mkdirSync(args.out, { recursive: true })
	for (const [name, json] of Object.entries(files)) {
		writeFileSync(join(args.out, name), JSON.stringify(json, null, '\t') + '\n')
		console.log(`  ${name}  ${json.productVersion}  ${json.sha256hash.slice(0, 12)}…`)
	}
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
	main().catch(err => {
		console.error(err.message)
		process.exit(1)
	})
}
