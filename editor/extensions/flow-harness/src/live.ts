/*---------------------------------------------------------------------------------------------
 *  Axle Harness: the harness at runtime. flow-agent forwards each hook event of the agents it
 *  runs (`flowHarness.recordEvent`); this counts what they used, reads their transcripts for what
 *  no hook reports, and on first run reads the last 30 days of this project's Claude Code
 *  transcripts so "never used" is not a guess on day one. Counts, prompts and failures are kept
 *  in this workspace's extension storage, bounded.
 *--------------------------------------------------------------------------------------------*/

import { promises as fs } from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';
import { countEvent, countTranscript, coveredDays, loadActivity, prune, summary, WINDOW_DAYS, type ActivityData, type AgentEvent, type HookLike, type Summary } from './activity';
import { redact, type FailureRecord, type PromptRecord } from './friction';
import { isTranscriptPath, parseTranscript, type TranscriptFacts } from './transcript';

const ACTIVITY = 'flowHarness.activity';
const FRICTION = 'flowHarness.friction';
const MAX_PROMPTS = 300;
const MAX_FAILURES = 300;
/** The most of one transcript read in one go: transcripts reach hundreds of MB, and the newest part is what matters. */
const MAX_READ = 4 << 20;
const BACKFILL_FILES = 60;
const DAY = 86_400_000;
/** Agents remembered by name, for the X-ray's session list. */
const MAX_SESSIONS = 50;

export interface FrictionData {
	prompts: PromptRecord[];
	failures: FailureRecord[];
	dismissed: string[];
}

export interface LiveSession {
	agent: string;
	cli: string;
	transcript?: string;
	at: number;
}

/** Where Claude Code keeps this folder's transcripts: the path with every character that is not a letter or digit turned into '-'. */
export const projectTranscriptDir = (root: string) => path.join(os.homedir(), '.claude', 'projects', root.replace(/[^A-Za-z0-9]/g, '-'));

const str = (v: unknown, max: number) => typeof v === 'string' ? v.slice(0, max) : undefined;

/** The page or another extension sends this: only known fields of the right type, each bounded, are kept. */
export function eventOf(raw: unknown): AgentEvent | undefined {
	const r = raw as Record<string, unknown> | undefined;
	if (!r || typeof r !== 'object' || typeof r.event !== 'string' || typeof r.agent !== 'string') {
		return undefined;
	}
	const input: Record<string, string> = {};
	if (r.input && typeof r.input === 'object') {
		// The same fields flow-agent forwards (EVENT_INPUT in its agents.ts): keep the two lists in step.
		for (const k of ['skill', 'subagent_type', 'command', 'file_path', 'path', 'url', 'pattern']) {
			const v = str((r.input as Record<string, unknown>)[k], 600);
			if (v !== undefined) {
				input[k] = v;
			}
		}
	}
	return {
		at: typeof r.at === 'number' && Number.isFinite(r.at) ? r.at : Date.now(),
		agent: r.agent.slice(0, 200), cli: str(r.cli, 20) ?? 'claude', session: str(r.session, 200), event: r.event.slice(0, 60),
		tool: str(r.tool, 200), input, error: str(r.error, 1000), durationMs: typeof r.durationMs === 'number' && Number.isFinite(r.durationMs) ? r.durationMs : undefined,
		prompt: str(r.prompt, 2000), agentType: str(r.agentType, 200), transcript: isTranscriptPath(r.transcript, os.homedir()) ? r.transcript : undefined,
	};
}

async function readFrom(file: string, offset: number): Promise<{ lines: string[]; end: number; size: number }> {
	const h = await fs.open(file, 'r');
	try {
		const size = (await h.stat()).size;
		let start = offset > size ? 0 : offset; // a shorter file was rewritten: read it again
		if (size - start > MAX_READ) {
			start = size - MAX_READ;
		}
		const buf = Buffer.alloc(size - start);
		await h.read(buf, 0, buf.length, start);
		const text = buf.toString('utf8');
		// Only whole lines: the last one may still be being written. A read that started mid-file drops its first, partial line.
		const lastNl = text.lastIndexOf('\n');
		const body = lastNl < 0 ? '' : text.slice(0, lastNl);
		const lines = body.split('\n');
		if (start > offset && start > 0) {
			lines.shift();
		}
		return { lines, end: start + (lastNl < 0 ? 0 : Buffer.byteLength(body, 'utf8') + 1), size };
	} finally {
		await h.close();
	}
}

export class Live implements vscode.Disposable {
	private data: ActivityData;
	private friction: FrictionData;
	readonly sessions = new Map<string, LiveSession>();
	private readonly changed = new vscode.EventEmitter<void>();
	readonly onDidChange = this.changed.event;
	private saveTimer: NodeJS.Timeout | undefined;
	private readonly reading = new Map<string, Promise<void>>();
	private backfilled = false;

	constructor(private readonly state: vscode.Memento, private readonly hooks: () => HookLike[]) {
		this.data = loadActivity(state.get(ACTIVITY), Date.now());
		const f = state.get<FrictionData>(FRICTION);
		this.friction = f && Array.isArray(f.prompts) && Array.isArray(f.failures) && Array.isArray(f.dismissed) ? f : { prompts: [], failures: [], dismissed: [] };
	}

	get frictionData(): Readonly<FrictionData> {
		return this.friction;
	}

	summary(key: string): Summary {
		return summary(this.data, key, Date.now());
	}

	get covered() {
		return coveredDays(this.data, Date.now());
	}

	/** How many transcripts the counts come from: "never used" needs a few sessions behind it, not one. */
	get sessionsSeen() {
		return Object.keys(this.data.transcripts).length;
	}

	record(raw: unknown) {
		const ev = eventOf(raw);
		if (!ev) {
			return;
		}
		const transcript = ev.transcript ?? this.sessions.get(ev.agent)?.transcript;
		this.sessions.delete(ev.agent);
		this.sessions.set(ev.agent, { agent: ev.agent, cli: ev.cli, transcript, at: ev.at });
		if (this.sessions.size > MAX_SESSIONS) {
			this.sessions.delete(this.sessions.keys().next().value!);
		}
		countEvent(this.data, ev, this.hooks());
		if (ev.event === 'UserPromptSubmit' && ev.prompt) {
			this.addPrompt({ text: ev.prompt, at: ev.at, cli: ev.cli, session: ev.session });
		}
		if (ev.event === 'PostToolUseFailure' && ev.tool && ev.error) {
			this.addFailure({ tool: ev.tool, subject: ev.input?.command ?? ev.input?.file_path ?? ev.input?.path ?? ev.input?.url ?? '', error: ev.error, at: ev.at, cli: ev.cli, session: ev.session });
		}
		// The turn is over: what the transcript adds (files loaded, hook failures, Stop hook times) is written by now.
		if (ev.transcript && ev.cli === 'claude' && (ev.event === 'Stop' || ev.event === 'SubagentStop' || ev.event === 'SessionEnd')) {
			void this.ingest(ev.transcript, true);
		}
		this.touch();
	}

	private addPrompt(p: PromptRecord) {
		this.friction.prompts.push({ ...p, text: redact(p.text.slice(0, 1000)) });
		this.friction.prompts.splice(0, Math.max(0, this.friction.prompts.length - MAX_PROMPTS));
	}

	private addFailure(f: FailureRecord) {
		this.friction.failures.push({ ...f, subject: redact(f.subject.slice(0, 300)), error: redact(f.error.slice(0, 600)) });
		this.friction.failures.splice(0, Math.max(0, this.friction.failures.length - MAX_FAILURES));
	}

	/** Forgets every stored prompt, failure and dismissal (the usage counts stay). */
	clearFriction() {
		this.friction = { prompts: [], failures: [], dismissed: [] };
		this.touch();
	}

	dismiss(id: string) {
		if (!this.friction.dismissed.includes(id)) {
			this.friction.dismissed.push(id);
			this.friction.dismissed.splice(0, Math.max(0, this.friction.dismissed.length - 500));
			this.touch();
		}
	}

	/**
	 * Reads what is new in a transcript. For a session Axle's hooks reported (`live`), tool calls, prompts and failures
	 * came as events already; for a past one they come from here.
	 */
	ingest(file: string, live: boolean): Promise<void> {
		if (!isTranscriptPath(file, os.homedir())) {
			return Promise.resolve();
		}
		const running = this.reading.get(file);
		if (running) {
			return running;
		}
		const job = (async () => {
			const seen = this.data.transcripts[file];
			const { lines, end } = await readFrom(file, seen?.offset ?? 0);
			const isLive = live || !!seen?.live;
			const facts = parseTranscript(lines);
			countTranscript(this.data, facts, this.hooks(), Date.now(), !isLive);
			if (!isLive) {
				const cutoff = Date.now() - WINDOW_DAYS * DAY;
				for (const p of facts.prompts) {
					const at = Date.parse(p.at ?? '') || Date.now();
					if (at >= cutoff) {
						this.addPrompt({ text: p.text, at, cli: 'claude', session: path.basename(file, '.jsonl') });
					}
				}
				for (const e of facts.toolErrors) {
					const at = Date.parse(e.at ?? '') || Date.now();
					const subject = typeof e.input.command === 'string' ? e.input.command : typeof e.input.file_path === 'string' ? e.input.file_path : '';
					if (at >= cutoff) {
						this.addFailure({ tool: e.tool, subject, error: e.error, at, cli: 'claude', session: path.basename(file, '.jsonl') });
					}
				}
			}
			this.data.transcripts[file] = { offset: end, live: isLive, at: Date.now() };
			this.touch();
		})().catch(e => console.warn(`flow-harness: could not read ${file}: ${(e as Error).message}`)).finally(() => this.reading.delete(file));
		this.reading.set(file, job);
		return job;
	}

	/** Once per window: the last 30 days of this folder's transcripts, newest first and bounded, read in the background. */
	async backfill(root: string) {
		if (this.backfilled) {
			return;
		}
		this.backfilled = true;
		const dir = projectTranscriptDir(root);
		const names = await fs.readdir(dir).catch(() => [] as string[]);
		const cutoff = Date.now() - WINDOW_DAYS * DAY;
		const files = (await Promise.all(names.filter(n => n.endsWith('.jsonl')).map(async n => {
			const file = path.join(dir, n);
			const st = await fs.stat(file).catch(() => undefined);
			return st && st.mtimeMs >= cutoff ? { file, mtime: st.mtimeMs, size: st.size } : undefined;
		}))).filter((x): x is { file: string; mtime: number; size: number } => !!x).sort((a, b) => b.mtime - a.mtime).slice(0, BACKFILL_FILES);
		for (const f of files) {
			// A transcript read before and unchanged since needs no second look.
			if (this.data.transcripts[f.file]?.offset !== f.size) {
				await this.ingest(f.file, false);
			}
		}
		// Every transcript of the window was read: from here on "never used in 30 days" is a fact about this project's sessions.
		this.data.since = Math.min(this.data.since, cutoff);
		this.touch();
	}

	/** Everything one transcript says, for the X-ray: its start (listings, memory, the first request) and its newest part. */
	async facts(file: string): Promise<TranscriptFacts | undefined> {
		if (!isTranscriptPath(file, os.homedir())) {
			return undefined;
		}
		try {
			const h = await fs.open(file, 'r');
			let head: string;
			let tail = '';
			try {
				const size = (await h.stat()).size;
				const headLen = Math.min(size, 2 << 20);
				const hb = Buffer.alloc(headLen);
				await h.read(hb, 0, headLen, 0);
				head = hb.toString('utf8');
				if (size > headLen) {
					const tailLen = Math.min(size - headLen, 2 << 20);
					const tb = Buffer.alloc(tailLen);
					await h.read(tb, 0, tailLen, size - tailLen);
					tail = tb.toString('utf8');
				}
			} finally {
				await h.close();
			}
			const headLines = head.split('\n');
			headLines.pop();
			const tailLines = tail ? tail.split('\n').slice(1) : [];
			return parseTranscript([...headLines, ...tailLines]);
		} catch {
			return undefined;
		}
	}

	private touch() {
		this.changed.fire();
		clearTimeout(this.saveTimer);
		this.saveTimer = setTimeout(() => this.save(), 1500);
	}

	private save() {
		prune(this.data, Date.now());
		void this.state.update(ACTIVITY, this.data);
		void this.state.update(FRICTION, this.friction);
	}

	dispose() {
		clearTimeout(this.saveTimer);
		this.save();
		this.changed.dispose();
	}
}
