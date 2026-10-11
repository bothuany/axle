/*---------------------------------------------------------------------------------------------
 *  Axle: language features for the card editor (completion, signature help, hover) and go-to-definition
 *  from the canvas. Who answers depends on the file (see `routeOf`):
 *    C#                             Roslyn, in the analyzer, on the card's text put into the solution in memory
 *    Java, Python, Go, PHP, Ruby, Rust  the polyglot index (types, members, parameters, locals, imports)
 *    TypeScript, JavaScript, others the editor's language servers (the card's text is first put into the real
 *                                   document, see overlay.ts), and the index when they say nothing
 *  Under every answer is the floor: the identifiers of the card and of its file, so completion is never worse than
 *  plain words. Every request leaves one line in the Axle output channel (route, what came back, how long).
 *--------------------------------------------------------------------------------------------*/

import { promises as fs } from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { Analyzer, type CardAsk } from './analyzer';
import { isBodyless, lineInCard, toCard, toCardRange, toDoc, type CardRange } from './cardmap';
import { isScript, lineBefore, mergeCompletions, rankWords, routeOf, WORD_SORT, wantsWords, wordBefore, type Route } from './completion';
import { CardOverlays, type CardText, type Synced } from './overlay';
import type { Place } from './poly/assist';
import { PolyIndex } from './poly/client';

/** What the canvas sends: the card (see `CardText`) and where in it the question is (Monaco's line and column, 1-based). */
export interface CardQuery extends CardText {
	line: number;
	column: number;
}

/** Things from the webview: whatever it sends is checked here, not trusted. */
export function cardQuery(m: Record<string, unknown>): CardQuery {
	const int = (v: unknown) => (typeof v === 'number' && Number.isInteger(v) && v >= 1 ? v : undefined);
	const str = (v: unknown) => (typeof v === 'string' ? v : undefined);
	const q = { session: str(m.session), file: str(m.file), startLine: int(m.startLine), endLine: int(m.endLine), original: str(m.original), text: str(m.text), line: int(m.line), column: int(m.column) };
	if (!q.session || !q.file || !q.startLine || !q.endLine || q.original === undefined || q.text === undefined || !q.line || !q.column) {
		throw new Error('Malformed language request.');
	}
	return q as CardQuery;
}

/** The wire shapes of the answers; ranges are Monaco's (1-based) and always inside the card. */
export interface WireItem {
	label: string;
	labelDetail?: string;
	labelDescription?: string;
	kind: number;
	tags?: number[];
	detail?: string;
	documentation?: { value: string; markdown: boolean };
	sortText?: string;
	filterText?: string;
	preselect?: boolean;
	insertText: string;
	snippet: boolean;
	keepWhitespace?: boolean;
	insert?: CardRange;
	replace?: CardRange;
	commitCharacters?: string[];
	edits?: { range: CardRange; text: string }[];
	/** The item needs an edit outside the card (an import above the method): not applied by the canvas. */
	needsImport?: boolean;
}

export interface WireCompletions {
	items: WireItem[];
	incomplete?: boolean;
	/** Something the user should know (why the language server did not answer). */
	message?: string;
	/** `message` is a one-time hint, not a refusal: the canvas keeps it on the bar a little longer. */
	hint?: boolean;
	/** A newer request replaced this one. */
	stale?: boolean;
}

interface WireDoc {
	value: string;
	markdown: boolean;
}

interface WireSignatures {
	activeSignature?: number;
	activeParameter?: number;
	signatures: { label: string; documentation?: WireDoc; activeParameter?: number; parameters: { label: string; documentation?: WireDoc }[] }[];
}

interface WireHover {
	contents: string[];
	range?: CardRange;
}

type Outcome = { ok: boolean; message?: string; local?: { lineNumber: number; column: number } };

/** What one source of completions came back with. `tag` says which, for the log. */
interface Served {
	items: WireItem[];
	incomplete?: boolean;
	message?: string;
	hint?: boolean;
	stale?: boolean;
	tag: string;
}

/** The completions asked for once the first N items get their documentation (each one costs a round trip to the server). */
const RESOLVE_COUNT = 8;
/** More items than this are cut: the canvas then asks again as the user types, with a narrower prefix. */
const MAX_ITEMS = 1500;

const markdown = (d: string | vscode.MarkdownString | undefined) => (d === undefined ? undefined : typeof d === 'string' ? (d ? { value: d, markdown: false } : undefined) : d.value ? { value: d.value, markdown: true } : undefined);

type Inside = { startLine: number; lines: number };

const TIMEOUT = Symbol('timeout');

/**
 * What a language server answers, or `TIMEOUT` when it takes longer than `ms` (a server still starting): everything here runs
 * one after the other, so a server that never answers must not hold up Save, Cancel and the next question.
 */
function within<T>(job: Thenable<T>, ms: number): Promise<T | typeof TIMEOUT | undefined> {
	return new Promise(resolve => {
		const timer = setTimeout(() => resolve(TIMEOUT), ms);
		Promise.resolve(job).then(v => { clearTimeout(timer); resolve(v); }, () => { clearTimeout(timer); resolve(undefined); });
	});
}

const COMPLETE_MS = 5000;
const QUICK_MS = 3000;
/** Words of the card and its file offered next to (or instead of) the server's items. */
const MAX_WORDS = 400;
/** A file's text is read again after this long: completion asks on every key. */
const FILE_CACHE_MS = 5000;
const MAX_FILE_BYTES = 600_000;

/** What to tell the user to install, by file extension: languages no route here answers for. */
const SUPPORT: Record<string, { id: string; name: string; search: string }> = {
	kt: { id: 'kotlin', name: 'Kotlin', search: 'Kotlin' },
	swift: { id: 'swift', name: 'Swift', search: 'Swift' },
	cpp: { id: 'cpp', name: 'C++', search: 'C/C++' },
	cc: { id: 'cpp', name: 'C++', search: 'C/C++' },
	c: { id: 'c', name: 'C', search: 'C/C++' },
};

/** Languages the user was already told about, once per window (this module lives as long as the extension host). */
const hinted = new Set<string>();

/** Is there an extension that is not built in and contributes this language, or one that wakes up for it? */
function hasLanguageSupport(id: string): boolean {
	const root = vscode.env.appRoot.toLowerCase();
	return vscode.extensions.all.some(e => {
		const pkg = (e.packageJSON ?? {}) as { isBuiltin?: boolean; activationEvents?: string[]; contributes?: { languages?: { id?: string }[] } };
		if (pkg.activationEvents?.includes(`onLanguage:${id}`)) {
			return true;
		}
		const builtIn = pkg.isBuiltin === true || e.extensionPath.toLowerCase().startsWith(root);
		return !builtIn && !!pkg.contributes?.languages?.some(l => l.id === id);
	});
}

/** The one-time hint for a language nobody answers for, or `undefined` (supported, unknown to us, or already told). */
function supportHint(file: string): string | undefined {
	const s = SUPPORT[file.split('.').pop()?.toLowerCase() ?? ''];
	if (!s || hinted.has(s.id) || hasLanguageSupport(s.id)) {
		return undefined;
	}
	hinted.add(s.id);
	return `No ${s.name} language support installed: smart completion needs it (Extensions: search '${s.search}').`;
}

function singleLine(r: vscode.Range | undefined, c: Inside): CardRange | undefined {
	if (!r || r.start.line !== r.end.line) {
		return undefined;
	}
	return toCardRange(c.startLine, c.lines, { start: { line: r.start.line, character: r.start.character }, end: { line: r.end.line, character: r.end.character } });
}

function wireItem(item: vscode.CompletionItem, c: Inside): WireItem {
	const label = typeof item.label === 'string' ? { label: item.label } : item.label;
	const insert = item.insertText;
	const snippet = insert instanceof vscode.SnippetString;
	const out: WireItem = {
		label: label.label,
		labelDetail: 'detail' in label ? label.detail : undefined,
		labelDescription: 'description' in label ? label.description : undefined,
		kind: item.kind ?? vscode.CompletionItemKind.Text,
		tags: item.tags?.map(Number),
		detail: item.detail,
		documentation: markdown(item.documentation),
		sortText: item.sortText,
		filterText: item.filterText,
		preselect: item.preselect || undefined,
		insertText: insert === undefined ? label.label : snippet ? insert.value : insert,
		snippet,
		keepWhitespace: item.keepWhitespace || undefined,
		commitCharacters: item.commitCharacters,
	};
	const r = item.range;
	if (r && 'inserting' in r) {
		out.insert = singleLine(r.inserting, c);
		out.replace = singleLine(r.replacing, c);
	} else {
		out.insert = out.replace = singleLine(r, c);
	}
	if (!out.insert || !out.replace) {
		out.insert = out.replace = undefined;
	}
	if (item.additionalTextEdits?.length) {
		const edits = item.additionalTextEdits.map(e => ({ range: toCardRange(c.startLine, c.lines, { start: { line: e.range.start.line, character: e.range.start.character }, end: { line: e.range.end.line, character: e.range.end.character } }), text: e.newText }));
		if (edits.every(e => e.range)) {
			out.edits = edits as { range: CardRange; text: string }[];
		} else {
			out.needsImport = true;
		}
	}
	return out;
}

/** A location as `Location` or `LocationLink` can spell it: where to go, and what to select there. */
interface Target {
	uri: vscode.Uri;
	range: vscode.Range;
}

function targets(list: (vscode.Location | vscode.LocationLink)[] | undefined): Target[] {
	const out: Target[] = [];
	for (const l of list ?? []) {
		const t: Target | undefined = 'targetUri' in l ? { uri: l.targetUri, range: l.targetSelectionRange ?? l.targetRange } : l.uri ? { uri: l.uri, range: l.range } : undefined;
		if (t && !out.some(o => o.uri.toString() === t.uri.toString() && o.range.start.isEqual(t.range.start))) {
			out.push(t);
		}
	}
	return out;
}

/** What the analyzer is asked about a card. */
const ask = (q: CardQuery, trigger?: string): CardAsk => ({ file: q.file, startLine: q.startLine, endLine: q.endLine, original: q.original, text: q.text, line: q.line, column: q.column, trigger });

const failure = (e: unknown) => ((e as Error)?.name === 'TimeoutError' ? 'timed out' : (e as Error)?.message ?? String(e));

export class CardLanguage {
	/** A question that is still waiting when a newer one of its kind arrives is dropped: only the latest cursor position matters. */
	private readonly stamps = { complete: 0, signature: 0, hover: 0 };
	private readonly files = new Map<string, { at: number; text: string }>();

	/** `log`: where the one line per request goes; by default the channel the analyzer logs to. */
	constructor(private readonly overlays: CardOverlays, private readonly log?: () => vscode.LogOutputChannel | undefined) { }

	/** One line per request: what asked, who answered, what came back, how long. Always at info, so a silent popup can be explained from the log. */
	private note(op: string, q: { file?: unknown; startLine?: number; line?: number; column?: number }, trigger: string | undefined, what: string, since: number) {
		try {
			const file = typeof q.file === 'string' ? vscode.workspace.asRelativePath(q.file, false) : '?';
			const line = (q.startLine ?? 1) + (q.line ?? 1) - 1;
			(this.log?.() ?? Analyzer.current?.log)?.info(`card ${op} ${file}:${line}:${q.column ?? 1}${trigger ? ` [${trigger}]` : ''} ${what} ${Date.now() - since} ms`);
		} catch {
			// A log line must never fail a request.
		}
	}

	/** The text of a file, for the words in it: an open document as it is now, else the file (a few seconds old at most). */
	private async fileText(file: string): Promise<string> {
		const open = vscode.workspace.textDocuments.find(d => d.uri.scheme === 'file' && d.uri.fsPath === vscode.Uri.file(file).fsPath);
		if (open) {
			return open.getText();
		}
		const hit = this.files.get(file);
		if (hit && Date.now() - hit.at < FILE_CACHE_MS) {
			return hit.text;
		}
		let text = '';
		try {
			if ((await fs.stat(file)).size <= MAX_FILE_BYTES) {
				text = await fs.readFile(file, 'utf8');
			}
		} catch {
			// not readable: no words from it
		}
		this.files.set(file, { at: Date.now(), text });
		if (this.files.size > 20) {
			this.files.delete(this.files.keys().next().value!);
		}
		return text;
	}

	// ---- completion ---------------------------------------------------------------------------------

	private async csharpItems(q: CardQuery, trigger: string | undefined): Promise<Served> {
		const analyzer = Analyzer.current;
		if (!analyzer?.isReady) {
			return { items: [], message: 'C# analysis is still loading: only words of the file for now.', hint: true, tag: 'roslyn:not-ready' };
		}
		try {
			const r = await analyzer.assist<{ items: WireItem[]; incomplete?: boolean; message?: string | null }>('complete', ask(q, trigger));
			return { items: r?.items ?? [], incomplete: r?.incomplete, message: r?.message ?? undefined, tag: 'roslyn' };
		} catch (e) {
			return { items: [], message: `C# completion failed (${failure(e)}).`, tag: 'roslyn:error' };
		}
	}

	private async indexItems(q: CardQuery): Promise<Served> {
		const poly = PolyIndex.current;
		if (!poly?.isReady) {
			return { items: [], message: 'The code index is still building: only words of the file for now.', hint: true, tag: 'index:not-ready' };
		}
		try {
			const r = await poly.complete({ file: q.file, startLine: q.startLine, before: lineBefore(q.text, q.line, q.column) });
			const items = r.items.map((s): WireItem => ({ label: s.label, kind: s.kind, detail: s.detail, insertText: s.insertText, snippet: s.snippet, sortText: s.sortText }));
			return { items, tag: r.why ? `index (${r.why})` : 'index' };
		} catch (e) {
			return { items: [], tag: `index:error (${failure(e)})` };
		}
	}

	/** The editor's own providers, on the real document with the card's text in it. */
	private async editorItems(q: CardQuery, trigger: string | undefined, stamp: number): Promise<Served> {
		return this.overlays.run(async (): Promise<Served> => {
			if (stamp !== this.stamps.complete) {
				return { items: [], stale: true, tag: 'editor:stale' };
			}
			const at = await this.at(q);
			if (!at.ok) {
				return { items: [], message: at.message, tag: 'editor:refused' };
			}
			const list = await within(vscode.commands.executeCommand<vscode.CompletionList | vscode.CompletionItem[] | undefined>('vscode.executeCompletionItemProvider', at.uri, at.position, trigger, RESOLVE_COUNT), COMPLETE_MS);
			if (list === TIMEOUT) {
				return { items: [], message: 'The language server is not answering yet.', tag: 'editor:timeout' };
			}
			const items = Array.isArray(list) ? list : list?.items ?? [];
			const cut = items.length > MAX_ITEMS;
			return { items: items.slice(0, MAX_ITEMS).map(i => wireItem(i, at.inside)), incomplete: cut || (!Array.isArray(list) && !!list?.isIncomplete), tag: 'editor' };
		});
	}

	async complete(q: CardQuery, trigger: string | undefined): Promise<WireCompletions> {
		const stamp = ++this.stamps.complete;
		const started = Date.now();
		const route: Route = routeOf(q.file);
		let got: Served;
		try {
			got = route === 'roslyn' ? await this.csharpItems(q, trigger) : route === 'index' ? await this.indexItems(q) : await this.editorItems(q, trigger, stamp);
			if (route === 'vscode' && !got.items.length && !got.stale) {
				// A script nobody answers for: the index knows its classes. Another language: say what is missing, once.
				if (isScript(q.file)) {
					const alt = await this.indexItems(q);
					if (alt.items.length) {
						got = { ...alt, tag: `${got.tag}+${alt.tag}` };
					}
				} else if (!got.message) {
					const hint = supportHint(q.file);
					got = hint ? { ...got, message: hint, hint: true } : got;
				}
			}
		} catch (e) {
			got = { items: [], message: `Completion failed (${failure(e)}).`, tag: `${route}:error` };
		}
		if (got.stale || stamp !== this.stamps.complete) {
			this.note('complete', q, trigger, `route=${got.tag} dropped (a newer request replaced it)`, started);
			return { items: [], stale: true };
		}
		let items = got.items;
		let words = 0;
		if (wantsWords(trigger, items.length)) {
			const typing = wordBefore(q.text, q.line, q.column);
			const merged = mergeCompletions(items, rankWords(q.text, await this.fileText(q.file), typing, MAX_WORDS), (label): WireItem => ({ label, kind: vscode.CompletionItemKind.Text, insertText: label, snippet: false, sortText: WORD_SORT + label }));
			items = merged.items;
			words = merged.words;
		}
		this.note('complete', q, trigger, `route=${got.tag} items=${got.items.length} words=${words}${got.message ? ` message="${got.message}"` : ''}`, started);
		return { items, incomplete: got.incomplete, message: got.message, hint: got.hint };
	}

	// ---- signature help and hover -------------------------------------------------------------------

	async signature(q: CardQuery, trigger: string | undefined): Promise<WireSignatures | null> {
		const stamp = ++this.stamps.signature;
		const started = Date.now();
		const route = routeOf(q.file);
		let tag: string = route;
		let answer: WireSignatures | null = null;
		try {
			if (route === 'roslyn') {
				const r = await Analyzer.current?.assist<{ activeSignature: number; activeParameter: number; items: { label: string; documentation?: WireDoc | null; parameters: { label: string; documentation?: WireDoc | null }[] }[] } | null>('signature', ask(q, trigger));
				answer = r ? { activeSignature: r.activeSignature, activeParameter: r.activeParameter, signatures: r.items.map(s => ({ label: s.label, documentation: s.documentation ?? undefined, parameters: s.parameters.map(p => ({ label: p.label, documentation: p.documentation ?? undefined })) })) } : null;
				tag = Analyzer.current?.isReady ? 'roslyn' : 'roslyn:not-ready';
			} else if (route === 'index') {
				answer = await this.indexSignature(q);
			} else {
				answer = await this.overlays.run(() => this.editorSignature(q, trigger, stamp));
				if (!answer && isScript(q.file)) {
					answer = await this.indexSignature(q);
					tag = answer ? 'editor+index' : 'editor';
				}
			}
		} catch (e) {
			tag = `${route}:error (${failure(e)})`;
		}
		this.note('signature', q, trigger, `route=${tag} ${answer ? `${answer.signatures.length} signature(s), parameter ${answer.activeParameter ?? 0}` : 'none'}`, started);
		return stamp === this.stamps.signature ? answer : null;
	}

	private async indexSignature(q: CardQuery): Promise<WireSignatures | null> {
		const poly = PolyIndex.current;
		if (!poly?.isReady) {
			return null;
		}
		const s = await poly.signature({ file: q.file, startLine: q.startLine, before: lineBefore(q.text, q.line, q.column) });
		return s ? { activeSignature: 0, activeParameter: s.active, signatures: [{ label: s.label, parameters: s.params.map(label => ({ label })) }] } : null;
	}

	private async editorSignature(q: CardQuery, trigger: string | undefined, stamp: number): Promise<WireSignatures | null> {
		if (stamp !== this.stamps.signature) {
			return null;
		}
		const at = await this.at(q);
		if (!at.ok) {
			return null;
		}
		const help = await within(vscode.commands.executeCommand<vscode.SignatureHelp | undefined>('vscode.executeSignatureHelpProvider', at.uri, at.position, trigger), QUICK_MS);
		if (help === TIMEOUT || !help?.signatures.length) {
			return null;
		}
		return {
			activeSignature: help.activeSignature,
			activeParameter: help.activeParameter,
			signatures: help.signatures.map(s => ({
				label: s.label,
				documentation: markdown(s.documentation),
				activeParameter: s.activeParameter,
				parameters: s.parameters.map(p => ({ label: p.label as string, documentation: markdown(p.documentation) })),
			})),
		};
	}

	async hover(q: CardQuery): Promise<WireHover | null> {
		const stamp = ++this.stamps.hover;
		const started = Date.now();
		const route = routeOf(q.file);
		let answer: WireHover | null = null;
		let tag: string = route;
		try {
			if (route === 'roslyn') {
				const r = await Analyzer.current?.assist<{ contents: string[]; range?: CardRange | null } | null>('hover', ask(q));
				answer = r ? { contents: r.contents, range: r.range ?? undefined } : null;
				tag = Analyzer.current?.isReady ? 'roslyn' : 'roslyn:not-ready';
			} else if (route === 'vscode') {
				answer = await this.overlays.run(() => this.editorHover(q, stamp));
			} else {
				tag = 'index:no-hover';
			}
		} catch (e) {
			tag = `${route}:error (${failure(e)})`;
		}
		this.note('hover', q, undefined, `route=${tag} ${answer ? 'answered' : 'none'}`, started);
		return stamp === this.stamps.hover ? answer : null;
	}

	private async editorHover(q: CardQuery, stamp: number): Promise<WireHover | null> {
		if (stamp !== this.stamps.hover) {
			return null;
		}
		const at = await this.at(q);
		if (!at.ok) {
			return null;
		}
		const answer = await within(vscode.commands.executeCommand<vscode.Hover[] | undefined>('vscode.executeHoverProvider', at.uri, at.position), QUICK_MS);
		const hovers = answer === TIMEOUT ? undefined : answer;
		const contents = (hovers ?? []).flatMap(h => h.contents.map(c => {
			const part = c as string | vscode.MarkdownString | { language: string; value: string };
			return typeof part === 'string' ? part : 'language' in part ? '```' + part.language + '\n' + part.value + '\n```' : part.value;
		})).filter(Boolean);
		if (!contents.length) {
			return null;
		}
		const r = hovers!.find(h => h.range)?.range;
		return { contents, range: singleLine(r, at.inside) };
	}

	// ---- go to definition ---------------------------------------------------------------------------

	/**
	 * Go to the definition of the symbol at a position. `m` is a position in the open card (its text is shown to the
	 * server first), or `file` + `line` + `column` alone for the file as it is (a card that is only read).
	 * Resolves what the canvas should say, or where in the card it should move the cursor.
	 */
	async definition(m: Record<string, unknown>): Promise<Outcome> {
		const started = Date.now();
		const reading = m.session === undefined;
		const file = typeof m.file === 'string' ? m.file : '';
		const route = routeOf(file);
		const where = { file, startLine: Number(m.startLine) || Number(m.line) || 1, line: reading ? 1 : Number(m.line) || 1, column: Number(m.column) || 1 };
		let outcome: Outcome;
		let tag: string = route;
		try {
			if (route === 'vscode') {
				outcome = await this.definitionViaEditor(m, reading);
				if (!outcome.ok && !outcome.local && isScript(file)) {
					const alt = await this.definitionViaIndex(m, reading);
					if (alt.ok) {
						outcome = alt;
						tag = 'editor+index';
					}
				}
			} else if (route === 'roslyn') {
				outcome = await this.definitionViaRoslyn(m, reading);
			} else {
				outcome = await this.definitionViaIndex(m, reading);
			}
		} catch (e) {
			outcome = { ok: false, message: `Go to definition failed (${failure(e)}).` };
			tag = `${route}:error`;
		}
		this.note('definition', where, undefined, `route=${tag} ${outcome.ok ? (outcome.local ? 'in the card' : 'opened') : `none: ${outcome.message ?? ''}`}`, started);
		return outcome;
	}

	private async definitionViaRoslyn(m: Record<string, unknown>, reading: boolean): Promise<Outcome> {
		const analyzer = Analyzer.current;
		if (!analyzer?.isReady) {
			return { ok: false, message: 'C# analysis is still loading: try again in a moment.' };
		}
		const body: CardAsk = reading
			? { file: String(m.file), startLine: Number(m.line), endLine: Number(m.line), original: null, text: null, line: 1, column: Number(m.column) }
			: ask(cardQuery(m));
		const r = await analyzer.assist<{ places: Place[]; message?: string | null }>('definition', body);
		return this.finish(r?.places ?? [], reading, r?.message ?? 'No definition found.');
	}

	private async definitionViaIndex(m: Record<string, unknown>, reading: boolean): Promise<Outcome> {
		const poly = PolyIndex.current;
		if (!poly?.isReady) {
			return { ok: false, message: 'The code index is still building: try again in a moment.' };
		}
		let req: { file: string; startLine: number; lineText: string; column: number; cardText: string; cardLine: number };
		if (reading) {
			const file = String(m.file);
			const line = Number(m.line);
			const text = (await this.fileText(file)).replace(/\r\n/g, '\n').split('\n')[line - 1] ?? '';
			req = { file, startLine: line, lineText: text, column: Number(m.column), cardText: text, cardLine: 1 };
		} else {
			const q = cardQuery(m);
			req = { file: q.file, startLine: q.startLine, lineText: q.text.replace(/\r\n/g, '\n').split('\n')[q.line - 1] ?? '', column: q.column, cardText: q.text, cardLine: q.line };
		}
		const r = await poly.definition(req);
		return this.finish(r.places, reading, r.message ?? 'No definition found.');
	}

	/** Where the answer points: inside the card being edited the cursor moves, elsewhere the file opens (several: the user picks). */
	private async finish(places: Place[], reading: boolean, none: string): Promise<Outcome> {
		if (!places.length) {
			return { ok: false, message: none };
		}
		const pick = places.length === 1 ? places[0] : await this.choosePlace(places);
		if (!pick) {
			return { ok: true };
		}
		if (!reading && pick.cardLine && pick.cardColumn) {
			return { ok: true, local: { lineNumber: pick.cardLine, column: pick.cardColumn } };
		}
		const at = new vscode.Position(Math.max(0, pick.line - 1), Math.max(0, (pick.column ?? 1) - 1));
		await vscode.commands.executeCommand('vscode.open', vscode.Uri.file(pick.file), { viewColumn: vscode.ViewColumn.One, selection: new vscode.Range(at, at), preview: true } satisfies vscode.TextDocumentShowOptions);
		return { ok: true };
	}

	private async choosePlace(places: Place[]): Promise<Place | undefined> {
		const shown = places.slice(0, 30);
		const items = await Promise.all(shown.map(async p => {
			const line = (await this.declarationLine({ uri: vscode.Uri.file(p.file), range: new vscode.Range(p.line - 1, 0, p.line - 1, 0) }))?.trim();
			return { label: `${path.basename(p.file)}:${p.line}`, description: vscode.workspace.asRelativePath(p.file), detail: line ?? p.label, place: p } satisfies vscode.QuickPickItem & { place: Place };
		}));
		return (await vscode.window.showQuickPick(items, { placeHolder: 'Go to' }))?.place;
	}

	// ---- the editor's own providers (the card's text in the real document) --------------------------

	/** Show the card to the language servers and map where the question is. Call inside `overlays.run`. */
	private async at(q: CardQuery): Promise<{ ok: true; uri: vscode.Uri; position: vscode.Position; inside: Inside } | { ok: false; message?: string }> {
		const s: Synced = await this.overlays.sync(q);
		if (!s.ok) {
			return s;
		}
		const lines = s.overlay.curEnd - s.overlay.startLine + 1;
		if (q.line > lines) {
			return { ok: false, message: 'the position is outside the card' };
		}
		const p = toDoc(s.overlay.startLine, q.line, q.column);
		return { ok: true, uri: s.overlay.uri, position: new vscode.Position(p.line, p.character), inside: { startLine: s.overlay.startLine, lines } };
	}

	private async definitionViaEditor(m: Record<string, unknown>, reading: boolean): Promise<Outcome> {
		// The lookups run with the card shown to the server; the pick and the opening do not hold the queue.
		const looked = await this.overlays.run(async () => {
			let uri: vscode.Uri;
			let position: vscode.Position;
			let inside: Inside | undefined;
			if (reading) {
				const file = typeof m.file === 'string' ? m.file : '';
				const line = Number(m.line);
				const column = Number(m.column);
				if (!file || !Number.isInteger(line) || !Number.isInteger(column) || line < 1 || column < 1) {
					return { message: 'Malformed request.' };
				}
				uri = vscode.Uri.file(file);
				position = new vscode.Position(line - 1, column - 1);
			} else {
				const at = await this.at(cardQuery(m));
				if (!at.ok) {
					return { message: at.message };
				}
				({ uri, position, inside } = at);
			}
			const answer = await within(vscode.commands.executeCommand<(vscode.Location | vscode.LocationLink)[] | undefined>('vscode.executeDefinitionProvider', uri, position), COMPLETE_MS);
			if (answer === TIMEOUT) {
				return { message: 'The language server is not answering yet.' };
			}
			let found = targets(answer);
			if (!found.length) {
				return { message: 'No definition found.' };
			}
			// A member without a body (interface, abstract): what runs is an implementation, so offer those first.
			if (found.length === 1 && await this.bodyless(found[0])) {
				const asked = await within(vscode.commands.executeCommand<(vscode.Location | vscode.LocationLink)[] | undefined>('vscode.executeImplementationProvider', uri, position), QUICK_MS);
				const impls = asked === TIMEOUT ? [] : targets(asked);
				const others = impls.filter(i => !(i.uri.toString() === found[0].uri.toString() && i.range.start.isEqual(found[0].range.start)));
				if (others.length) {
					found = others.length === 1 ? others : [...others, found[0]];
				}
			}
			return { found, uri, inside };
		});
		if (!looked.found) {
			return { ok: false, message: looked.message };
		}
		const { found, uri, inside } = looked;
		const pick = found.length === 1 ? found[0] : await this.choose(found);
		if (!pick) {
			return { ok: true };
		}
		// Inside the card being edited: move the cursor there instead of opening the file.
		if (inside && pick.uri.toString() === uri.toString() && lineInCard(inside.startLine, inside.lines, pick.range.start.line)) {
			return { ok: true, local: toCard(inside.startLine, { line: pick.range.start.line, character: pick.range.start.character }) };
		}
		await vscode.commands.executeCommand('vscode.open', pick.uri, { viewColumn: vscode.ViewColumn.One, selection: pick.range, preview: true } satisfies vscode.TextDocumentShowOptions);
		return { ok: true };
	}

	private async declarationLine(t: Target): Promise<string | undefined> {
		try {
			return (await vscode.workspace.openTextDocument(t.uri)).lineAt(t.range.start.line).text;
		} catch {
			return undefined;
		}
	}

	private async bodyless(t: Target) {
		const line = await this.declarationLine(t);
		return line !== undefined && isBodyless(line);
	}

	/** Several places: let the user pick one (the first is the likeliest). */
	private async choose(found: Target[]): Promise<Target | undefined> {
		const shown = found.slice(0, 30);
		const items = await Promise.all(shown.map(async t => {
			const line = (await this.declarationLine(t))?.trim();
			const rel = t.uri.scheme === 'file' ? vscode.workspace.asRelativePath(t.uri) : t.uri.toString();
			return { label: `${path.basename(t.uri.path)}:${t.range.start.line + 1}`, description: rel, detail: line, target: t } satisfies vscode.QuickPickItem & { target: Target };
		}));
		return (await vscode.window.showQuickPick(items, { placeHolder: 'Go to' }))?.target;
	}
}
