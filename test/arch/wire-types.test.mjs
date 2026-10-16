// Compiles wire-types.ts and reports only its own diagnostics: the imported extension sources are type-checked by each
// extension's own `typecheck` (which needs the VS Code checkout), not here.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

test('the host\'s FlowNode, EntryPoint and DbSchema still fit what the canvas reads', () => {
	const configPath = fileURLToPath(new URL('./tsconfig.json', import.meta.url));
	const { config } = ts.readConfigFile(configPath, ts.sys.readFile);
	const parsed = ts.parseJsonConfigFileContent(config, ts.sys, fileURLToPath(new URL('.', import.meta.url)));
	const program = ts.createProgram(parsed.fileNames, parsed.options);
	const file = program.getSourceFiles().find(f => f.fileName.endsWith('/test/arch/wire-types.ts'));
	assert.ok(file, 'wire-types.ts is in the program');
	const errors = program.getSemanticDiagnostics(file).map(d => ts.flattenDiagnosticMessageText(d.messageText, '\n'));
	assert.deepEqual(errors, []);
});
