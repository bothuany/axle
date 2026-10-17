/*---------------------------------------------------------------------------------------------
 *  Axle Harness: the agents' own memory, read only. Claude Code keeps an auto memory per project
 *  in ~/.claude/projects/<project key>/memory: MEMORY.md, an index loaded into every session, and
 *  one topic file per memory with name / description / metadata.type in its frontmatter. This
 *  reads them and lists the file paths and code names a memory mentions, so they can be checked against the code as it is now. Axle keeps no
 *  memory of its own. Pure (no vscode).
 *--------------------------------------------------------------------------------------------*/

/** Claude Code's key for a project folder: the path with every character that is not a letter or digit as '-'. */
export function projectKey(folder: string): string {
	return folder.replace(/[^A-Za-z0-9]/g, '-');
}

export type MemoryType = 'user' | 'feedback' | 'project' | 'reference';

export interface Memory {
	file: string;
	name: string;
	description: string;
	type?: MemoryType;
	/** From the frontmatter (metadata.modified), else the file's own time. */
	modified?: number;
	body: string;
	/** The line MEMORY.md points at it from, if it does. */
	indexLine?: number;
}

export interface IndexEntry {
	title: string;
	target: string;
	hook: string;
	line: number;
}

const TYPES = new Set(['user', 'feedback', 'project', 'reference']);

/** `- [Title](file.md) — hook` lines of MEMORY.md. */
export function parseIndex(text: string): IndexEntry[] {
	const out: IndexEntry[] = [];
	text.split(/\r?\n/).forEach((l, line) => {
		const m = /^\s*[-*]\s*\[(?<title>[^\]]+)\]\((?<target>[^)]+)\)\s*(?:[—–-]+\s*(?<hook>.*))?$/.exec(l);
		if (m?.groups) {
			out.push({ title: m.groups.title.trim(), target: m.groups.target.trim(), hook: (m.groups.hook ?? '').trim(), line });
		}
	});
	return out;
}

/** A topic file: frontmatter (top-level keys and one level under metadata:) and the body after it. */
export function parseMemory(file: string, text: string): Memory {
	const lines = text.split(/\r?\n/);
	const fm: Record<string, string> = {};
	let bodyStart = 0;
	if (lines[0]?.trim() === '---') {
		const end = lines.findIndex((l, i) => i > 0 && l.trim() === '---');
		if (end > 0) {
			let parent = '';
			for (const l of lines.slice(1, end)) {
				const kv = /^(\s*)([\w-]+)\s*:\s*(.*)$/.exec(l);
				if (!kv) {
					continue;
				}
				const nested = kv[1].length > 0;
				if (!nested) {
					parent = kv[3] ? '' : kv[2];
				}
				fm[nested && parent ? `${parent}.${kv[2]}` : kv[2]] = kv[3].trim().replace(/^(["'])(.*)\1$/, '$2');
			}
			bodyStart = end + 1;
		}
	}
	const type = fm['metadata.type'] ?? fm.type;
	const modified = Date.parse(fm['metadata.modified'] ?? fm.modified ?? '');
	return {
		file,
		name: fm.name || file.replace(/^.*[\\/]/, '').replace(/\.md$/i, ''),
		description: fm.description ?? '',
		type: TYPES.has(type) ? type as MemoryType : undefined,
		modified: Number.isFinite(modified) ? modified : undefined,
		body: lines.slice(bodyStart).join('\n').trim(),
	};
}

export interface Mentions {
	/** Relative or absolute paths that look like files: `src/x.ts`, `editor/vscode/`. */
	paths: string[];
	/** Code names: `Class.method`, `Class#method`, `fooBar()`, `UserService`. */
	symbols: string[];
}

const KNOWN_WORDS = /^(?:README|CLAUDE|AGENTS|MEMORY|TODO|JSON|YAML|HTTP|HTTPS|API|URL|CLI|MCP|LLM|CI|PR|UI|IDE|OS|Why|How)$/;

/**
 * The paths and code names a memory mentions. Only what is clearly meant as one counts: a path needs a slash and a file
 * extension (or a trailing slash), a symbol needs code formatting or the Class.member shape. Prose never becomes a finding.
 */
export function mentions(body: string): Mentions {
	const paths = new Set<string>();
	const symbols = new Set<string>();
	const text = body.replace(/https?:\/\/\S+/g, ' ');
	const add = (raw: string) => {
		const s = raw.trim().replace(/[.,;:]+$/, '');
		if (/^[~./\w-]*[\\/][\w./\\-]*(?:\.[A-Za-z]{1,6}|[\\/])$/.test(s) && !/^\d/.test(s)) {
			paths.add(s.replace(/\\/g, '/'));
			return;
		}
		const sym = s.replace(/\(\)$/, '');
		if (/^[A-Za-z_$][\w$]*(?:(?:\.|#|::)[A-Za-z_$][\w$]*)+$/.test(sym) && !/^[a-z]+\.(?:md|ts|js|json|py|cs|java|go|rs|mjs|cjs|yml|yaml|txt)$/i.test(sym)) {
			symbols.add(sym);
		} else if (/^[A-Za-z_$][\w$]*$/.test(sym) && (/\(\)$/.test(s) || /^[A-Z][a-z0-9]+[A-Z]\w*$/.test(sym) || /^[a-z]+[A-Z]\w*$/.test(sym)) && !KNOWN_WORDS.test(sym)) {
			symbols.add(sym);
		}
	};
	for (const m of text.matchAll(/`([^`\n]{2,120})`/g)) {
		add(m[1]);
	}
	// Outside code formatting only the unmistakable shapes: Class.method() and paths with a folder and an extension.
	const plain = text.replace(/`[^`\n]*`/g, ' ');
	for (const m of plain.matchAll(/(?:^|[\s(])((?:\.{1,2}\/|[\w-]+\/)[\w./-]+\.[A-Za-z]{1,6})(?=$|[\s),;:])/gm)) {
		add(m[1]);
	}
	for (const m of plain.matchAll(/\b([A-Z]\w+\.[a-z]\w*)\(\)/g)) {
		add(m[1]);
	}
	return { paths: [...paths], symbols: [...symbols] };
}

/** The line to add to CLAUDE.md for a memory: its rule in one bullet, the why kept when the memory gives one. */
export function promotedLine(m: Memory): string {
	const first = m.body.split(/\r?\n/).map(l => l.trim()).find(l => l && !/^\*\*(?:Why|How to apply):?\*\*/i.test(l) && !l.startsWith('#'));
	const why = /\*\*Why:?\*\*\s*(.+)/i.exec(m.body)?.[1]?.trim();
	const rule = (first ?? m.description).replace(/\s+/g, ' ').replace(/\.$/, '');
	return `- ${rule}.${why ? ` (Why: ${why.replace(/\.$/, '')}.)` : ''}`;
}
