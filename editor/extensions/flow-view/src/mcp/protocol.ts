/*---------------------------------------------------------------------------------------------
 *  Axle agent bridge: the MCP side of the `axle` server. Newline-delimited JSON-RPC over a pair of
 *  streams (stdio in the real server, in-memory streams in tests). Nothing but JSON-RPC is ever
 *  written to the output; diagnostics go to `log`. `initialize` and `tools/list` always succeed:
 *  a problem with the Axle window is a tool result with isError, which the model can read and act on.
 *--------------------------------------------------------------------------------------------*/

import { createInterface } from 'readline';
import type { Readable, Writable } from 'stream';
import { getPrompt, promptList } from './prompts';
import { TOOLS, TOOL_NAMES } from './tools';

export interface ToolResult {
	content: { type: 'text'; text: string }[];
	isError?: boolean;
}

/** Runs a tool somewhere (the Axle window) and answers; throwing is the same as an error result. */
export type Forward = (tool: string, args: Record<string, unknown>) => Promise<ToolResult>;

export const SERVER_VERSION = '0.1.0';
const DEFAULT_PROTOCOL = '2025-06-18';

export const INSTRUCTIONS = [
	"Axle is the user's code editor. These tools act on the Axle window that has the current folder open.",
	'To open a file or place in the editor use `open`. To show how a feature runs, use `find_entry_points` then `show_flow` (it opens the flow canvas for the user) or `flow_text` (the same call chain as text, to understand code without reading many files).',
	'Use `impact` before changing shared code (or, with `table` or `entity`, a table or its entity), `get_context` to see what the user is looking at, and `draw_board` (kinds: flow, plan, class, er, sequence, architecture) to show the user a flow or plan you designed; tick plan steps with `update_board`.',
	'To explain or walk the user through code, SHOW it with `tour`: get file:line from `flow_text` first, 3-12 steps in the order the code runs, one idea per step, captions that say why and not what (run the `tour_guide` prompt for the advice). The user\'s questions during a tour come back to you; answer them through `tour_control`.',
].join('\n');

export const errorResult = (text: string): ToolResult => ({ content: [{ type: 'text', text }], isError: true });

type Id = string | number | null;
interface Rpc { jsonrpc?: string; id?: Id; method?: unknown; params?: unknown }

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

export class McpServer {
	constructor(private readonly forward: Forward, private readonly log: (message: string) => void = () => undefined) { }

	/** One message (or batch) in, the reply line out; undefined when nothing is to be sent (notifications). */
	async handle(line: string): Promise<string | undefined> {
		let parsed: unknown;
		try {
			parsed = JSON.parse(line);
		} catch {
			return JSON.stringify({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } });
		}
		if (Array.isArray(parsed)) {
			const replies = (await Promise.all(parsed.map(m => this.one(m)))).filter((r): r is object => r !== undefined);
			return replies.length ? JSON.stringify(replies) : undefined;
		}
		const reply = await this.one(parsed);
		return reply && JSON.stringify(reply);
	}

	private async one(raw: unknown): Promise<object | undefined> {
		if (!isObject(raw)) {
			return { jsonrpc: '2.0', id: null, error: { code: -32600, message: 'Invalid Request' } };
		}
		const msg = raw as Rpc;
		const hasId = msg.id !== undefined;
		if (typeof msg.method !== 'string') {
			// A response to something we never sent, or garbage: nothing to answer.
			return hasId && msg.id !== null && !('result' in raw) && !('error' in raw) ? { jsonrpc: '2.0', id: msg.id, error: { code: -32600, message: 'Invalid Request' } } : undefined;
		}
		const reply = (result: unknown) => hasId ? { jsonrpc: '2.0', id: msg.id, result } : undefined;
		const fail = (code: number, message: string) => hasId ? { jsonrpc: '2.0', id: msg.id, error: { code, message } } : undefined;
		const params = isObject(msg.params) ? msg.params : {};
		switch (msg.method) {
			case 'initialize':
				return reply({
					// Echo the client's version: Claude Code is newer than any version written down here.
					protocolVersion: typeof params.protocolVersion === 'string' ? params.protocolVersion : DEFAULT_PROTOCOL,
					capabilities: { tools: {}, prompts: {} },
					serverInfo: { name: 'axle', version: SERVER_VERSION },
					instructions: INSTRUCTIONS,
				});
			case 'ping':
				return reply({});
			case 'tools/list':
				return reply({ tools: TOOLS });
			case 'tools/call':
				return hasId ? reply(await this.call(params)) : undefined;
			case 'resources/list':
				return reply({ resources: [] });
			case 'prompts/list':
				return reply({ prompts: promptList() });
			case 'prompts/get': {
				const prompt = getPrompt(params.name, isObject(params.arguments) ? params.arguments : {});
				return prompt ? reply(prompt) : fail(-32602, `Unknown prompt: ${String(params.name)}. Prompts: ${promptList().map(p => p.name).join(', ')}.`);
			}
			default:
				// notifications/initialized, notifications/cancelled and the like need no answer.
				return msg.method.startsWith('notifications/') ? undefined : fail(-32601, `Method not found: ${msg.method}`);
		}
	}

	private async call(params: Record<string, unknown>): Promise<ToolResult> {
		const name = params.name;
		if (typeof name !== 'string' || !TOOL_NAMES.has(name)) {
			return errorResult(`Unknown tool: ${String(name)}. Tools: ${TOOLS.map(t => t.name).join(', ')}.`);
		}
		const args = isObject(params.arguments) ? params.arguments : {};
		const tool = TOOLS.find(t => t.name === name)!;
		const missing = ((tool.inputSchema.required as string[] | undefined) ?? []).filter(k => args[k] === undefined || args[k] === null);
		if (missing.length) {
			return errorResult(`${name}: missing required argument${missing.length > 1 ? 's' : ''}: ${missing.join(', ')}.`);
		}
		try {
			return await this.forward(name, args);
		} catch (e) {
			this.log(`${name} failed: ${(e as Error)?.message ?? e}`);
			return errorResult(`${name} failed: ${(e as Error)?.message ?? e}`);
		}
	}
}

/** Reads lines from `input` until it ends, answering each on `output`. Resolves when the input is closed and every call has answered. */
export function serve(input: Readable, output: Writable, forward: Forward, log?: (message: string) => void): Promise<void> {
	const server = new McpServer(forward, log);
	const inflight = new Set<Promise<void>>();
	const rl = createInterface({ input, crlfDelay: Infinity });
	rl.on('line', line => {
		if (!line.trim()) {
			return;
		}
		const p = server.handle(line).then(out => {
			if (out !== undefined) {
				output.write(out + '\n');
			}
		}).catch(e => log?.(`handler error: ${(e as Error)?.message ?? e}`)).finally(() => inflight.delete(p));
		inflight.add(p);
	});
	return new Promise(resolve => rl.on('close', () => void Promise.all(inflight).then(() => resolve())));
}
