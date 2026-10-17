/*---------------------------------------------------------------------------------------------
 *  Axle Harness: changes to instruction files are shown as a diff and written only after a yes in
 *  one dialog, like settings changes. (The refactor preview listed them unticked, so its Apply
 *  silently did nothing unless the person ticked each change first.)
 *--------------------------------------------------------------------------------------------*/

import * as path from 'path';
import { appendInstruction } from './friction';
import { previewAndWriteFiles } from './settings';

/** Adds `line` at the end of `root/target` (creating the file with a heading when it is not there), after the user saw the diff. Resolves to whether it was written. */
export function appendLineReviewed(root: string, target: string, line: string, label: string): Promise<boolean> {
	return previewAndWriteFiles(label, [{ file: path.join(root, target), change: text => appendInstruction(text, line) }], 'Add');
}
