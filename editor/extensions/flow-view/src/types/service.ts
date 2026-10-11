/*---------------------------------------------------------------------------------------------
 *  Axle type model: which module (microservice) a source file belongs to: the nearest folder
 *  with a build manifest, else the workspace folder. The only place the type model reads the
 *  disk, so everything else stays a pure function.
 *--------------------------------------------------------------------------------------------*/

import * as fs from 'fs';
import * as path from 'path';

export interface ServiceRef {
	/** Folder name. */
	name: string;
	/** Absolute folder. */
	root: string;
}

const MANIFESTS = new Set(['pom.xml', 'build.gradle', 'build.gradle.kts', 'package.json', 'pyproject.toml', 'setup.py', 'go.mod', 'Cargo.toml', 'composer.json', 'Gemfile']);

/** A resolver that walks up from each file to the nearest manifest, stopping at the workspace folder; directory listings are cached. */
export function nearestServiceResolver(roots: readonly string[]): (file: string) => ServiceRef {
	const listings = new Map<string, boolean>();
	const hasManifest = (dir: string) => {
		let hit = listings.get(dir);
		if (hit === undefined) {
			try {
				hit = fs.readdirSync(dir).some(n => MANIFESTS.has(n) || n.endsWith('.csproj'));
			} catch {
				hit = false;
			}
			listings.set(dir, hit);
		}
		return hit;
	};
	const norm = (p: string) => path.resolve(p);
	const folders = roots.map(norm);
	return (file: string) => {
		const folder = folders.filter(r => norm(file).startsWith(r + path.sep)).sort((a, b) => b.length - a.length)[0];
		let dir = path.dirname(norm(file));
		for (;;) {
			if (hasManifest(dir)) {
				return { name: path.basename(dir), root: dir };
			}
			if (!folder || dir === folder || path.dirname(dir) === dir) {
				break;
			}
			dir = path.dirname(dir);
		}
		const root = folder ?? path.dirname(norm(file));
		return { name: path.basename(root), root };
	};
}
