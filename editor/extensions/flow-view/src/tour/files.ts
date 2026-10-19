/*---------------------------------------------------------------------------------------------
 *  Axle: how a tour file's code is read. A tour is untrusted input (it can come from a pull request), so a path is judged by the
 *  real file behind it, never by how it is spelled, and what is read is bounded. Pure: no `vscode`.
 *--------------------------------------------------------------------------------------------*/

import { closeSync, fstatSync, openSync, readSync, realpathSync } from 'fs';
import { insideWorkspace } from './validate';

/** A peek card shows a few lines: this much of a file is enough, and a minified bundle is not read whole. */
export const PEEK_READ_BYTES = 512 * 1024;

/**
 * `file` as the real file it is (symlinks resolved), when that is inside a workspace folder. A tour is untrusted: a symlink in a
 * pull request that points out of the workspace must not make Axle read what is behind it.
 */
export function realInside(roots: string[], file: string): string | undefined {
	try {
		return insideWorkspace(roots.map(r => realpathSync.native(r)), realpathSync.native(file));
	} catch {
		return undefined;
	}
}

/** The start of a workspace file for a peek card, or nothing: only a regular file, read through its handle, never more than PEEK_READ_BYTES. */
export function readTextIn(roots: string[]) {
	return (file: string): string | undefined => {
		const real = realInside(roots, file);
		if (!real) {
			return undefined;
		}
		let fd: number | undefined;
		try {
			fd = openSync(real, 'r');
			if (!fstatSync(fd).isFile()) {
				return undefined;
			}
			const buffer = Buffer.alloc(PEEK_READ_BYTES);
			return buffer.toString('utf8', 0, readSync(fd, buffer, 0, buffer.length, 0));
		} catch {
			return undefined;
		} finally {
			if (fd !== undefined) {
				closeSync(fd);
			}
		}
	};
}
