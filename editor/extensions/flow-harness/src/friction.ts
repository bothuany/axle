/*---------------------------------------------------------------------------------------------
 *  Axle Harness: the friction inbox. What keeps going wrong between you and your agents, turned
 *  into a fix you can review: a correction you keep typing ("don't use X", "always run Y", in
 *  English or Turkish) becomes a proposed CLAUDE.md / AGENTS.md line; a tool call that keeps
 *  failing the same way becomes a proposed guard hook. Each proposal carries its evidence: which
 *  prompts or failures, and how often. Pure (no vscode), so the clustering is tested on its own.
 *--------------------------------------------------------------------------------------------*/

export interface PromptRecord {
	text: string;
	at: number;
	cli: string;
	session?: string;
}

export interface FailureRecord {
	tool: string;
	/** The command (Bash) or the path, bounded. */
	subject: string;
	error: string;
	at: number;
	cli: string;
	session?: string;
}

export interface Evidence {
	text: string;
	at: number;
	session?: string;
}

export interface Proposal {
	/** Stable across runs, so a dismissed proposal stays dismissed. */
	id: string;
	kind: 'instruction' | 'hook';
	title: string;
	/** The line to add (instruction) or the reason the guard gives the agent (hook). */
	text: string;
	/** Which file it belongs in: CLAUDE.md for Claude sessions, AGENTS.md for Codex. */
	targets: ('CLAUDE.md' | 'AGENTS.md')[];
	evidence: Evidence[];
	/** Hooks: the tool and the command prefix the guard matches. */
	tool?: string;
	prefix?: string;
	/** Set when the instructions already say this: the line is there, yet the correction keeps coming. */
	covered?: boolean;
}

/** A sentence that tells the agent what (not) to do: imperatives, prohibitions and "instead of" corrections. */
const CORRECTION = [
	/\b(?:don'?t|do not|never|stop|avoid|no need to|quit|please don'?t|shouldn'?t|should not|must not|mustn'?t)\b/i,
	/\b(?:always|make sure(?: to| that)?|remember to|be sure to|use \S+ instead|instead of|rather than)\b/i,
	// Turkish: never / always / don't forget, and the common "don't …" verb forms.
	/(?:^|[\s,])(?:asla|hiçbir zaman|her zaman|daima|unutma|sakın|yerine)(?=[\s,.!]|$)/i,
	/(?:^|\s)\S+\s+(?:kullanma|yapma|etme|atma|silme|yazma|ekleme|değiştirme|çalıştırma|açma|bozma|dokunma|koyma|gönderme)(?=[\s,.!]|$)/i,
];
/** Prompts that only quote a correction back, or talk about the agent's last answer, are not standing instructions. */
const NOT_STANDING = /\?\s*$|^(?:why|neden|niye)\b/i;

const STOP = new Set(('the a an to of and or in on for with is are be it this that you your me my we our i please just also again here there now any ever do ' +
	'bir ve ile bu şu o da de mi mı için gibi daha çok lütfen ben sen biz siz ama fakat yani artık hep tekrar yine burada şimdi').split(' '));

/** Lowercased words that carry the meaning, accents and punctuation aside. */
export function signature(sentence: string): string[] {
	// "don't", "do not" and "never" say the same thing; the wording must not split one correction into two.
	const plain = sentence.toLocaleLowerCase('tr').replace(/\b(?:do\s+not|don'?t|dont|does\s+not|doesn'?t|never)\b/g, ' not ');
	return [...new Set(plain.replace(/[`'"“”‘’()[\]{}<>.,;:!?*]/g, ' ').split(/\s+/)
		.map(w => w.replace(/^-+|-+$/g, '')).filter(w => w.length > 1 && !STOP.has(w)))];
}

const jaccard = (a: string[], b: string[]) => {
	const sb = new Set(b);
	const inter = a.filter(x => sb.has(x)).length;
	return inter / (new Set([...a, ...b]).size || 1);
};

/** The corrections in one prompt: sentences that read as a standing instruction. */
export function corrections(prompt: string): string[] {
	// Pasted text, code and quoted lines are someone else's words (an agent's output, a log), not the person's instruction.
	const own = prompt
		.replace(/<pasted_content\b[^>]*>[\s\S]*?(?:<\/pasted_content>|$)/g, '\n')
		.replace(/```[\s\S]*?(?:```|$)/g, '\n')
		.replace(/^\s*>.*$/gm, '');
	return own.split(/(?<=[.!?])\s+|\r?\n+/).map(s => s.trim().replace(/^[-*•]\s*/, ''))
		.filter(s => s.length >= 6 && s.length <= 220 && !NOT_STANDING.test(s) && CORRECTION.some(re => re.test(s)) && signature(s).length >= 2);
}

function hash(s: string) {
	let h = 2166136261;
	for (let i = 0; i < s.length; i++) {
		h = Math.imul(h ^ s.charCodeAt(i), 16777619);
	}
	return (h >>> 0).toString(36);
}

const targetsOf = (clis: string[]) => {
	const t: Proposal['targets'] = [];
	if (clis.some(c => c !== 'codex')) {
		t.push('CLAUDE.md');
	}
	if (clis.includes('codex')) {
		t.push('AGENTS.md');
	}
	return t;
};

/** A correction as a line for an instructions file: first letter up, a full stop at the end. */
export function asInstruction(sentence: string): string {
	const s = sentence.trim().replace(/\s+/g, ' ').replace(/[.!]+$/, '');
	return `${s.charAt(0).toLocaleUpperCase('tr')}${s.slice(1)}.`;
}

/**
 * Corrections that came back at least `min` times, in at least two separate prompts, grouped by meaning (word overlap).
 * `instructions` is the text the agents already read: a proposal it already covers is marked, not dropped.
 */
export function correctionProposals(prompts: readonly PromptRecord[], instructions = '', min = 2): Proposal[] {
	type Cluster = { sig: string[]; items: (Evidence & { sentence: string; cli: string; prompt: number })[] };
	const clusters: Cluster[] = [];
	// The same prompt twice (an event and its transcript, a resumed session) is one prompt, not a repeat.
	const unique = prompts.filter((p, i) => !prompts.slice(0, i).some(q => q.text === p.text && Math.abs(q.at - p.at) < 5000));
	unique.forEach((p, index) => {
		for (const sentence of corrections(p.text)) {
			const sig = signature(sentence);
			const home = clusters.find(c => jaccard(c.sig, sig) >= 0.5);
			const item = { text: p.text.slice(0, 400), at: p.at, session: p.session, sentence, cli: p.cli, prompt: index };
			if (home) {
				home.items.push(item);
				home.sig = [...new Set([...home.sig, ...sig])].filter(w => home.items.filter(i => signature(i.sentence).includes(w)).length * 2 >= home.items.length);
			} else {
				clusters.push({ sig, items: [item] });
			}
		}
	});
	const known = new Set(signature(instructions));
	return clusters
		.filter(c => c.items.length >= min && new Set(c.items.map(i => i.prompt)).size >= 2)
		.map(c => {
			// The wording closest to what the cluster shares, and of those the shortest, says it most plainly.
			const fit = (x: string) => jaccard(signature(x), c.sig);
			const best = [...c.items].sort((a, b) => fit(b.sentence) - fit(a.sentence) || a.sentence.length - b.sentence.length)[0].sentence;
			const sig = signature(best);
			return {
				id: `fix:${hash(sig.slice().sort().join(' '))}`,
				kind: 'instruction' as const,
				title: `You said this ${c.items.length} times: "${best.length > 70 ? `${best.slice(0, 67)}…` : best}"`,
				text: asInstruction(best),
				targets: targetsOf(c.items.map(i => i.cli)),
				evidence: c.items.map(i => ({ text: i.text, at: i.at, session: i.session })).sort((a, b) => b.at - a.at),
				covered: sig.length > 0 && sig.filter(w => known.has(w)).length / sig.length >= 0.8,
			};
		})
		.sort((a, b) => b.evidence.length - a.evidence.length);
}

/** An error reduced to what stays the same between two runs: no paths, numbers, quoted values or ids. */
export function errorShape(error: string): string {
	const first = error.split(/\r?\n/).map(l => l.trim()).find(l => l && !/^exit code \d+$/i.test(l)) ?? error.trim();
	return first.toLowerCase()
		.replace(/(?:[a-z]:)?[\\/][^\s'"`:]+/gi, '<path>')
		.replace(/(["'`]).*?\1/g, '<q>')
		.replace(/\b0x[0-9a-f]+\b|\b[0-9a-f]{8,}\b/g, '<id>')
		.replace(/\d+/g, '<n>')
		.replace(/\s+/g, ' ')
		.slice(0, 120);
}

/** The words of a command that say what it is: `npm test`, `git push`, `dotnet build`. */
export function commandHead(command: string): string {
	const words = command.trim().replace(/^(?:\w+=\S*\s+)+/, '').split(/\s+/);
	const program = (words[0] ?? '').replace(/^.*[\\/]/, '');
	const second = words[1] && !words[1].startsWith('-') && !/[\\/.]/.test(words[1]) ? ` ${words[1]}` : '';
	return `${program}${second}`.trim();
}

/** A failure that says the person stopped it, not that the tool cannot work. */
const NOT_A_FAILURE = /doesn't want to proceed|rejected|interrupted|user denied|permission (?:to use .* |for this action )?(?:was|has been) denied|denied by the .*classifier|cancel+ed/i;

/** Tool calls that failed the same way at least `min` times: a guard hook for commands, an instruction line for other tools. */
export function failureProposals(failures: readonly FailureRecord[], min = 3): Proposal[] {
	const groups = new Map<string, FailureRecord[]>();
	for (const f of failures) {
		if (NOT_A_FAILURE.test(f.error) || !f.error.trim()) {
			continue;
		}
		const head = f.tool === 'Bash' ? commandHead(f.subject) : '';
		const key = `${f.tool}|${head}|${errorShape(f.error)}`;
		groups.set(key, [...(groups.get(key) ?? []), f]);
	}
	const out: Proposal[] = [];
	for (const [key, list] of groups) {
		if (list.length < min) {
			continue;
		}
		const [tool, head] = key.split('|');
		const sample = list[list.length - 1].error.split(/\r?\n/).map(l => l.trim()).find(l => l && !/^exit code \d+$/i.test(l)) ?? list[0].error;
		const short = sample.length > 140 ? `${sample.slice(0, 137)}…` : sample;
		const evidence = list.map(f => ({ text: `${f.subject ? `${f.subject.slice(0, 200)}\n` : ''}${f.error.slice(0, 300)}`, at: f.at, session: f.session })).sort((a, b) => b.at - a.at);
		if (tool === 'Bash' && head) {
			out.push({
				id: `hook:${hash(key)}`, kind: 'hook', tool, prefix: head,
				title: `\`${head}\` failed ${list.length} times with the same error`,
				text: `\`${head}\` keeps failing in this project with "${short}". Before running it again, <say what to do instead>.`,
				targets: targetsOf(list.map(f => f.cli)), evidence,
			});
		} else {
			out.push({
				id: `fail:${hash(key)}`, kind: 'instruction', tool,
				title: `${tool} failed ${list.length} times with the same error`,
				text: `${tool} keeps failing here with "${short}": <say how to avoid it>.`,
				targets: targetsOf(list.map(f => f.cli)), evidence,
			});
		}
	}
	return out.sort((a, b) => b.evidence.length - a.evidence.length);
}

/** The guard hook script for a proposal: a PreToolUse hook that stops `prefix` commands and tells the agent why (exit 2). */
export function guardScript(prefix: string, reason: string): string {
	return `// PreToolUse (Bash): written by Axle's friction inbox. Stops \`${prefix}\` before it fails the same way again; exit 2 sends the reason back to the agent.
let input = ''
process.stdin.on('data', d => input += d)
process.stdin.on('end', () => {
	const command = String(JSON.parse(input || '{}').tool_input?.command ?? '').trim()
	const prefix = ${JSON.stringify(prefix)}
	if (command === prefix || command.startsWith(prefix + ' ')) {
		process.stderr.write(${JSON.stringify(reason)} + '\\n')
		process.exit(2)
	}
})
`;
}

/** A file name for a guard script: `axle-guard-npm-test.mjs`. */
export const guardFileName = (prefix: string) => `axle-guard-${prefix.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'command'}.mjs`;

/**
 * Secrets that end up in prompts and commands (a pasted token, `export API_KEY=…`) are blanked before anything is stored,
 * so the inbox never keeps one on disk or shows one in a tooltip.
 */
export function redact(text: string): string {
	return text
		.replace(/\b(?:sk|pk|rk)-[A-Za-z0-9_-]{16,}/g, '<secret>')
		.replace(/\b(?:ghp|gho|ghu|ghs|ghr|github_pat|glpat|xox[abpr])[-_][A-Za-z0-9_-]{16,}/g, '<secret>')
		.replace(/\bAKIA[0-9A-Z]{16}\b/g, '<secret>')
		.replace(/\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g, '<secret>')
		.replace(/\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{12,}/gi, '$1 <secret>')
		.replace(/\b([A-Za-z_][A-Za-z0-9_]*(?:KEY|TOKEN|SECRET|PASSWORD|PASSWD|PWD|CREDENTIALS?))\s*[=:]\s*("[^"]*"|'[^']*'|\S+)/gi, '$1=<secret>')
		.replace(/\b(password|passwd|pwd|token|secret|api[_-]?key)\s*[=:]\s*("[^"]*"|'[^']*'|\S+)/gi, '$1=<secret>');
}
