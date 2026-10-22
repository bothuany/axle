/*---------------------------------------------------------------------------------------------
 *  Insilode: why there is no flow at the cursor, in words a developer can act on. "No language server
 *  answered" was said for every cause (a file that does not parse, a cursor outside any function,
 *  a language Insilode does not trace), which sent people looking for an extension they did not need.
 *  Pure (no vscode), so it is tested on its own.
 *--------------------------------------------------------------------------------------------*/

/** Languages Insilode traces itself (the polyglot index or Roslyn), by VS Code language id. */
const TRACED = new Set(['java', 'python', 'javascript', 'typescript', 'javascriptreact', 'typescriptreact', 'go', 'php', 'ruby', 'rust', 'csharp']);

const NAMES: Record<string, string> = { lua: 'Lua', cpp: 'C++', c: 'C', kotlin: 'Kotlin', swift: 'Swift', scala: 'Scala', dart: 'Dart', elixir: 'Elixir', haskell: 'Haskell', perl: 'Perl', r: 'R', shellscript: 'Shell', powershell: 'PowerShell', vb: 'Visual Basic', fsharp: 'F#', clojure: 'Clojure', groovy: 'Groovy', objc: 'Objective-C' };

/**
 * The message for a cursor with no flow. `errorLines`: the lines (1-based) of the file's error diagnostics,
 * the likeliest reason a traced language finds no function.
 */
export function noFlowReason(languageId: string, errorLines: readonly number[]): string {
	if (errorLines.length) {
		const lines = [...new Set(errorLines)].sort((a, b) => a - b);
		const where = lines.length === 1 ? `line ${lines[0]}` : `lines ${lines.slice(0, 3).join(', ')}${lines.length > 3 ? '…' : ''}`;
		return `This file has errors (${where}), so the function at the cursor cannot be read. Fix them and trace again.`;
	}
	if (TRACED.has(languageId)) {
		return 'There is no function at the cursor. Put it inside a function or method and trace again.';
	}
	const name = NAMES[languageId] ?? languageId;
	return `Insilode does not trace ${name} yet. It traces Java, Python, JavaScript/TypeScript, Go, PHP, Ruby, Rust and C#; other languages need a language server that offers call hierarchy.`;
}
