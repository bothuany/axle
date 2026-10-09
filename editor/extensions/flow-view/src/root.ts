/*---------------------------------------------------------------------------------------------
 *  Flow: where the rest of the repository is. The Flow extensions are linked into the VS Code
 *  checkout (editor/vscode/extensions); the analyzer and the canvas build live at the repo root.
 *--------------------------------------------------------------------------------------------*/

import * as fs from 'fs';
import * as path from 'path';

/** The repository root: FLOW_ROOT, or the first folder above this extension that holds analyzer/. */
export function flowRoot(extensionPath: string): string {
	if (process.env.FLOW_ROOT) {
		return process.env.FLOW_ROOT;
	}
	let dir = extensionPath;
	try {
		dir = fs.realpathSync(extensionPath);
	} catch {
		// keep the path as given
	}
	for (let i = 0; i < 6; i++) {
		if (fs.existsSync(path.join(dir, 'analyzer', 'FlowAnalyzer.csproj'))) {
			return dir;
		}
		dir = path.dirname(dir);
	}
	return path.resolve(extensionPath, '..', '..', '..');
}
