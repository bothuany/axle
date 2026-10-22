/*---------------------------------------------------------------------------------------------
 *  Insilode: the trail in the status bar. Wherever the cursor is in C#, it shows the call path that
 *  leads there from an entry point (▶ endpoint › ◆ handler › ● method), in the canvas' colours.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { innermost, type Analyzer, type MethodInfo } from './analyzer';
import type { FlowNode } from './providers';

const KIND: Record<FlowNode['kind'], { glyph: string; color: string }> = {
	controller: { glyph: '▶', color: '#ffb454' },
	handler: { glyph: '◆', color: '#b88cff' },
	method: { glyph: '●', color: '#6f86ff' },
	db: { glyph: '●', color: '#4fd6d0' },
	ambiguous: { glyph: '◇', color: '#ff6b7d' },
	external: { glyph: '○', color: '#8e8e96' },
};

interface Step { label: string; kind: FlowNode['kind'] }

/** "SurveysController.Start" → "Surveys.Start"; "StartSurveyCommand ▸ Handler.Handle" → "StartSurveyCommand.Handle". */
function short(label: string) {
	const parts = label.replace(/\s*▸\s*/g, '.').split('.');
	const member = parts.pop()!;
	const owner = parts.find(p => !/^(Handler|Impl)$/.test(p) && p) ?? parts[0];
	return owner ? `${owner.replace(/Controller$/, '')}.${member}` : member;
}

/** Callers come as a tree (children = who calls me). Prefer a path that ends at an entry point. */
function pathToEntry(root: FlowNode): FlowNode[] {
	let best: FlowNode[] = [root];
	let bestIsEntry = root.kind === 'controller';
	const walk = (n: FlowNode, path: FlowNode[]) => {
		const isEntry = n.kind === 'controller';
		if ((isEntry && (!bestIsEntry || path.length < best.length)) || (!bestIsEntry && !isEntry && path.length > best.length)) {
			best = path;
			bestIsEntry = isEntry;
		}
		n.children.forEach(c => walk(c.node, [...path, c.node]));
	};
	walk(root, [root]);
	return best.reverse();
}

/** The trail walks around a codebase for hours: what it remembers is bounded, oldest first out. */
const MAX_FILES = 100;
const MAX_CHAINS = 300;
function capped(map: Map<string, unknown>, max: number) {
	while (map.size > max) {
		map.delete(map.keys().next().value!);
	}
}

export class FlowTrail implements vscode.Disposable {
	/** glyph + label per step; at most four steps (entry, …, parent, here). */
	private readonly items: vscode.StatusBarItem[] = [];
	private timer: NodeJS.Timeout | undefined;
	private current: string | undefined;
	private seq = 0;
	private readonly chains = new Map<string, Promise<Step[]>>();
	/** Per file, until it is saved: the analyzer reads the disk, so a keystroke gives it nothing new to say. */
	private readonly methodCache = new Map<string, Promise<MethodInfo[]>>();
	private readonly disposables: vscode.Disposable[] = [];

	constructor(private readonly analyzer: Analyzer) {
		for (let i = 0; i < 8; i++) {
			// Left side, just right of the branch; descending priority keeps them in order.
			const item = vscode.window.createStatusBarItem(`flow.trail.${i}`, vscode.StatusBarAlignment.Left, 45 - i);
			item.name = 'Flow trail';
			this.items.push(item);
		}
		this.disposables.push(
			analyzer.onDidBecomeReady(() => this.schedule(vscode.window.activeTextEditor)),
			vscode.window.onDidChangeTextEditorSelection(e => this.schedule(e.textEditor)),
			vscode.window.onDidChangeActiveTextEditor(e => this.schedule(e)),
			// A save can change who calls what.
			vscode.workspace.onDidSaveTextDocument(d => {
				if (d.languageId === 'csharp') {
					this.methodCache.delete(d.uri.fsPath);
					this.chains.clear();
					this.current = undefined;
					this.schedule(vscode.window.activeTextEditor);
				}
			}),
		);
		this.schedule(vscode.window.activeTextEditor);
	}

	private busy = false;
	private again = false;

	/**
	 * The analyzer answers one request at a time, so the trail never queues more than one: a cursor
	 * that keeps moving while it works gets a single fresh look afterwards ("Show flow at cursor" must not wait behind us).
	 */
	private schedule(_editor?: vscode.TextEditor) {
		clearTimeout(this.timer);
		this.timer = setTimeout(async () => {
			if (this.busy) {
				this.again = true;
				return;
			}
			this.busy = true;
			try {
				await this.update(vscode.window.activeTextEditor);
			} catch {
				this.hide();
			} finally {
				this.busy = false;
				if (this.again) {
					this.again = false;
					this.schedule();
				}
			}
		}, 350);
	}

	private methods(doc: vscode.TextDocument) {
		const key = doc.uri.fsPath;
		const hit = this.methodCache.get(key);
		if (hit) {
			return hit;
		}
		const methods = this.analyzer.methods(key);
		this.methodCache.set(key, methods);
		capped(this.methodCache, MAX_FILES);
		// A failed look (the analyzer is restarting) is not remembered: the next move of the cursor asks again.
		methods.catch(() => {
			if (this.methodCache.get(key) === methods) {
				this.methodCache.delete(key);
			}
		});
		return methods;
	}

	private async update(editor: vscode.TextEditor | undefined) {
		// Only when the analyzer is already up: the trail must never be the thing that loads a solution.
		if (!editor || editor.document.languageId !== 'csharp' || !this.analyzer.isReady) {
			return this.hide();
		}
		const seq = ++this.seq;
		const line = editor.selection.active.line + 1;
		const methods = await this.methods(editor.document);
		const hit = innermost(methods, line);
		if (!hit) {
			return this.hide();
		}
		if (hit.id === this.current) {
			return;
		}
		if (!this.chains.has(hit.id)) {
			const chain = this.analyzer.get<FlowNode>(`/api/callers?id=${encodeURIComponent(hit.id)}&depth=3`)
				.then(tree => pathToEntry(tree).map(n => ({ label: short(n.label), kind: n.kind })));
			// A failed look (analyzer restarting) must not stick: the next visit asks again.
			chain.catch(() => this.chains.delete(hit.id));
			this.chains.set(hit.id, chain);
			capped(this.chains, MAX_CHAINS);
		}
		const steps = await this.chains.get(hit.id)!;
		if (seq !== this.seq) {
			return;
		}
		this.current = hit.id;
		this.render(steps, hit);
	}

	private render(steps: Step[], here: MethodInfo) {
		this.hide();
		// Long paths keep both ends: where it starts, and the two steps nearest the cursor.
		const shown: (Step | null)[] = steps.length > 4 ? [steps[0], null, ...steps.slice(-2)] : steps;
		const tooltip = new vscode.MarkdownString(
			`**Flow trail**\n\n${steps.map((s, i) => `${'&nbsp;'.repeat(i * 3)}${KIND[s.kind].glyph} \`${s.label}\``).join('  \n')}\n\nClick to open this flow.`,
		);
		tooltip.supportHtml = true;
		const command: vscode.Command = { title: 'Open flow', command: 'flow.showMethod', arguments: [here.id, here.name] };
		let i = 0;
		shown.forEach((s, n) => {
			const last = n === shown.length - 1;
			const glyph = this.items[i++];
			const label = this.items[i++];
			if (!s) {
				glyph.text = '…';
				glyph.color = undefined;
				label.text = '›';
			} else {
				glyph.text = KIND[s.kind].glyph;
				glyph.color = KIND[s.kind].color;
				label.text = last ? s.label : `${s.label}  ›`;
				// Where you are reads brightest; the path that led here stays quiet.
				label.color = last ? '#e4e4e7' : undefined;
			}
			for (const item of [glyph, label]) {
				item.tooltip = tooltip;
				item.command = command;
				item.accessibilityInformation = { label: `Flow trail: ${steps.map(x => x.label).join(', then ')}` };
				item.show();
			}
		});
	}

	private hide() {
		this.current = undefined;
		this.items.forEach(i => i.hide());
	}

	dispose() {
		clearTimeout(this.timer);
		this.items.forEach(i => i.dispose());
		this.disposables.forEach(d => d.dispose());
	}
}
