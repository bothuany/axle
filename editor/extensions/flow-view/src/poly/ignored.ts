/*---------------------------------------------------------------------------------------------
 *  Insilode polyglot index: what git ignores. A real repository keeps build output, generated code and
 *  vendored checkouts out of git with .gitignore (Insilode's own repo ignores a whole VS Code checkout);
 *  indexing them makes the first index take minutes and fills the endpoint list with noise. Git
 *  itself is asked, so nested .gitignore files, .git/info/exclude and the global excludes all count
 *  exactly as `git status` counts them. Outside a git repository nothing is ignored.
 *--------------------------------------------------------------------------------------------*/

import { spawnSync } from 'child_process';
import * as path from 'path';

/** Case-folded on Windows, where `C:\X` and `c:\x` are one file. */
const key = (p: string) => {
	const n = path.normalize(p).replace(/[\\/]+$/, '');
	return process.platform === 'win32' ? n.toLowerCase() : n;
};

/**
 * The ignored paths in `git ls-files --others --ignored --exclude-standard --directory` output, made absolute
 * under `root`: an ignored directory is one line ending in '/', and nothing below it is listed.
 */
export function parseIgnored(root: string, stdout: string): Set<string> {
	const out = new Set<string>();
	for (const line of stdout.split('\n')) {
		const rel = line.replace(/\r$/, '');
		if (rel) {
			out.add(key(path.join(root, rel)));
		}
	}
	return out;
}

/** The untracked paths git ignores under `root`, or an empty set when `root` is not in a repository or git is missing. */
export function gitIgnored(root: string): Set<string> {
	const r = spawnSync('git', ['ls-files', '--others', '--ignored', '--exclude-standard', '--directory', '--no-empty-directory'], {
		cwd: root, encoding: 'utf8', timeout: 15_000, maxBuffer: 64 * 1024 * 1024, windowsHide: true,
	});
	return r.status === 0 && typeof r.stdout === 'string' ? parseIgnored(root, r.stdout) : new Set();
}

/** Whether `file` or any folder above it (up to the filesystem root) is in `ignored`. */
export function isIgnored(file: string, ignored: ReadonlySet<string>): boolean {
	if (!ignored.size) {
		return false;
	}
	for (let p = key(file); ; ) {
		if (ignored.has(p)) {
			return true;
		}
		const up = path.dirname(p);
		if (up === p) {
			return false;
		}
		p = up;
	}
}
