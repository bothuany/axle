/*---------------------------------------------------------------------------------------------
 *  Insilode: where the analyzer and the canvas build are. In the repository the Insilode extensions are linked
 *  into the VS Code checkout (editor/vscode) and both live at the repo root; in an installed Insilode they
 *  are inside the extension folder (analyzer/, ui/dist-webview/), put there by `npm run installer`.
 *--------------------------------------------------------------------------------------------*/

import * as fs from 'fs';
import * as path from 'path';

/** analyzer/FlowAnalyzer.csproj in the repository, the published analyzer/FlowAnalyzer.dll in an installed Insilode. */
const hasAnalyzer = (dir: string) => ['FlowAnalyzer.csproj', 'FlowAnalyzer.dll'].some(f => fs.existsSync(path.join(dir, 'analyzer', f)));

/** FLOW_ROOT, or the first folder from this extension upwards that holds analyzer/: the extension itself when installed, the repository root otherwise. */
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
		if (hasAnalyzer(dir)) {
			return dir;
		}
		dir = path.dirname(dir);
	}
	return path.resolve(extensionPath, '..', '..', '..');
}
