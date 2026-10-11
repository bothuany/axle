/*---------------------------------------------------------------------------------------------
 *  Axle polyglot index: what each source file declares, in one shape for every language. The
 *  extractors (java.ts, python.ts, js.ts) fill it from tree-sitter trees; graph.ts resolves it.
 *--------------------------------------------------------------------------------------------*/

import * as fs from 'fs';
import * as path from 'path';

export type Lang = 'java' | 'python' | 'js' | 'go' | 'php' | 'ruby' | 'rust';

/** An annotation or decorator: `@GetMapping("/x")`, `@router.get("/x", ...)`, `@Column({ name })`. */
export interface Ann {
	/** Last segment of the name: GetMapping, get, Column. */
	name: string;
	/** Full dotted name as written: router.get, javax.ws.rs.Path. */
	full: string;
	/** First string literal argument, or `value = "..."`. */
	value?: string;
	/** Named arguments, raw source text: { name: '"users"', method: 'RequestMethod.POST' }. */
	named: Record<string, string>;
	/** Every argument, raw source text. */
	args: string[];
}

export interface CallFact {
	name: string;
	/** Receiver as written, simplified: this, self, repo, this.repo, self.db, User, a.b. Absent for a bare call. */
	recv?: string;
	line: number;
	/** First argument as raw text (entity classes, SQL, route handlers). */
	arg0?: string;
	/** String literal arguments (concatenated literals joined), for SQL and JPQL. */
	strings: string[];
	/** Everything the call chain starts from: `db.query(User).filter(...).all()` → ['query','filter','all']. */
	chain?: string[];
}

export interface FieldFact {
	name: string;
	type: string;
	/** Generic arguments of the declared type: Repository<User> → ['User']. */
	typeArgs: string[];
	annotations: Ann[];
	line: number;
	/** Right-hand side as raw text (Python/JS class attributes, Django fields). */
	init?: string;
	/** The declared type exactly as written (`Map<String, List<UserDto>>`, `string[]`, `Optional[User]`): typeArgs only keeps the first level. */
	typeText?: string;
	/** UML visibility: + public, - private, # protected, ~ package. Absent when the language or the extractor does not say. */
	visibility?: '+' | '-' | '#' | '~';
	isStatic?: boolean;
	isFinal?: boolean;
	/** Declared optional or nullable in the type syntax itself (TS `x?: T`, `T | null`). */
	optional?: boolean;
}

/** A parameter as declared, in order: Record<name, type> on FuncFact loses the order, the generics and the annotations. */
export interface ParamFact {
	name: string;
	typeText: string;
	/** Annotation or decorator simple names: RequestBody, PathVariable, Valid. */
	anns: string[];
}

export interface FuncFact {
	/** file#Owner.name@line: stable within a file version. */
	id: string;
	name: string;
	owner?: string;
	file: string;
	line: number;
	endLine: number;
	params: Record<string, string>;
	locals: Record<string, string>;
	/** String values assigned to locals (`String sql = "select ..."`), for queries passed by variable. */
	consts: Record<string, string>;
	annotations: Ann[];
	calls: CallFact[];
	isPublic: boolean;
	isStatic: boolean;
	returns?: string;
	/** Exported from its module (JS/TS) or top-level (Python). */
	exported?: boolean;
	/** Express-style inline handler: the route it was registered for. */
	inlineRoute?: { verb: string; path: string };
	/** Parameters in declaration order, with their raw types and annotations. */
	paramInfo?: ParamFact[];
	visibility?: '+' | '-' | '#' | '~';
	isAbstract?: boolean;
	typeParams?: string[];
	/** getName() { return name; }: set only on the facts the type model receives (the bodies are left out there). */
	isAccessor?: boolean;
}

export interface TypeFact {
	name: string;
	file: string;
	line: number;
	endLine: number;
	kind: 'class' | 'interface' | 'enum';
	isAbstract: boolean;
	/** Superclass and interfaces, simple names. */
	supers: string[];
	/** Generic arguments per super: { JpaRepository: ['User', 'Long'] }. */
	superArgs: Record<string, string[]>;
	annotations: Ann[];
	fields: FieldFact[];
	methods: string[];
	/** Made up from a method's receiver (Go, Rust) because the declaring file was not seen: merged into the real type. */
	stub?: boolean;
	/** What `kind` flattens: a Java record, a C#/Rust/Go struct, a TS type alias of an object type. */
	declKind?: 'class' | 'interface' | 'enum' | 'record' | 'struct' | 'alias';
	/** Simple name of the enclosing type for a nested one. */
	outer?: string;
	typeParams?: string[];
	enumConstants?: string[];
	visibility?: '+' | '-' | '#' | '~';
}

/** A route registered by a call rather than an annotation: `app.get('/x', handler)`, Django `path(...)`. */
export interface RouteFact {
	verb: string;
	path: string;
	/** Handler as written: an identifier, `ctrl.method`, `views.fn`, `View.as_view()`, or an inline function id. */
	handler: string;
	line: number;
	/** The router variable it was registered on, for prefixes: router, app, bp. */
	on?: string;
}

export interface FileFacts {
	file: string;
	lang: Lang;
	mtime: number;
	/** Java package or Python/JS module path. */
	module?: string;
	/** Java: packages imported with a wildcard (`import com.x.*;` → `com.x`). */
	starImports?: string[];
	/** Local name → what it refers to: a class FQN (Java), `./models:User` (JS), `app.models:User` (Python). */
	imports: Record<string, string>;
	types: TypeFact[];
	funcs: FuncFact[];
	routes: RouteFact[];
	/** Router objects with a prefix: `APIRouter(prefix="/users")`, `Blueprint(url_prefix=...)`, `app.use('/api', router)`. */
	prefixes: Record<string, string>;
	/** Module-level variable types: `const repo = new UserRepo()`, `router = APIRouter()`. */
	globals: Record<string, string>;
}

/** Same shapes the canvas and the endpoints list use (custom-ide/ui/src/types.ts). */
export interface DbColumn {
	name: string;
	column: string;
	type: string;
	key: boolean;
	nullable: boolean;
	maxLength: number | null;
}

export interface DbSchema {
	entity: string;
	table: string;
	dbSchemaName: string | null;
	context: string;
	columns: DbColumn[];
	relations: string[];
	ops: string[];
	writes: boolean;
	file: string | null;
	line: number;
}

export interface EntryPoint {
	id: string;
	controller: string;
	action: string;
	http: string;
	file: string;
	line: number;
}

/** Directory names whose files are never indexed (dependencies, caches, editor state), wherever they are. */
export const EXCLUDED_DIRS = new Set([
	'node_modules', '.git', 'dist', '.venv', 'venv', '__pycache__',
	'.next', '.nuxt', 'coverage', 'bower_components', 'third_party',
	'.idea', '.vscode', '.gradle', '.mvn', '.claude', 'site-packages', '.tox', '.mypy_cache', '.pytest_cache',
]);

/**
 * Names that are build output or vendored code only beside a file of the project that produces it: `com.acme.build`
 * is a Java package, `target/` next to a pom.xml is not. A `*.ext` entry matches by suffix.
 */
const EXCLUDED_BESIDE = new Map<string, string[]>([
	['build', ['pom.xml', 'build.gradle', 'build.gradle.kts', 'settings.gradle', 'settings.gradle.kts', 'Cargo.toml', 'package.json', 'CMakeLists.txt']],
	['out', ['pom.xml', 'build.gradle', 'build.gradle.kts', 'settings.gradle', 'settings.gradle.kts', 'Cargo.toml', 'package.json', '*.iml']],
	['target', ['pom.xml', 'build.gradle', 'build.gradle.kts', 'Cargo.toml', 'package.json']],
	['bin', ['*.csproj', '*.fsproj', '*.vbproj', '.classpath']],
	['obj', ['*.csproj', '*.fsproj', '*.vbproj']],
	['vendor', ['composer.json', 'go.mod', 'Gemfile', 'Cargo.toml']],
]);

/**
 * Whether a directory is skipped. `siblings` are the names next to it, `full` its path: the walk already has the
 * listing, the watcher and the language server read it (only for the few names that need it).
 */
export function isExcludedDir(name: string, full: string, siblings: () => readonly string[]): boolean {
	if (EXCLUDED_DIRS.has(name)) {
		return true;
	}
	if (name === 'env') {
		return fs.existsSync(path.join(full, 'pyvenv.cfg')); // a virtualenv says so itself
	}
	const markers = EXCLUDED_BESIDE.get(name);
	return !!markers && siblings().some(s => markers.some(m => m.startsWith('*') ? s.endsWith(m.slice(1)) : s === m));
}

export function langOf(file: string): Lang | 'ts' | 'tsx' | undefined {
	if (file.endsWith('.go') && !file.endsWith('_test.go')) {
		return 'go';
	}
	if (file.endsWith('.php')) {
		return 'php';
	}
	if (file.endsWith('.rb')) {
		return 'ruby';
	}
	if (file.endsWith('.rs')) {
		return 'rust';
	}
	if (file.endsWith('.java')) {
		return 'java';
	}
	if (file.endsWith('.py')) {
		return 'python';
	}
	if (/\.(m|c)?jsx?$/.test(file)) {
		return 'js';
	}
	if (file.endsWith('.tsx')) {
		return 'tsx';
	}
	if (/\.(m|c)?ts$/.test(file) && !file.endsWith('.d.ts')) {
		return 'ts';
	}
	return undefined;
}

/**
 * Whether a file lies under an excluded directory, judged by the path below its workspace folder only (either path
 * separator): `/opt/build/app/src/x.py` is not excluded for the folder `/opt/build/app`. The watcher, the walk and the
 * language server filter agree.
 */
export function isExcludedPath(fsPath: string, root: string): boolean {
	const rel = path.relative(root, fsPath);
	if (!rel || rel === '..' || rel.startsWith(`..${path.sep}`) || path.isAbsolute(rel)) {
		return false;
	}
	let dir = root;
	for (const name of rel.split(/[\\/]/).slice(0, -1)) {
		const parent = dir;
		dir = path.join(dir, name);
		if (isExcludedDir(name, dir, () => listing(parent))) {
			return true;
		}
	}
	return false;
}

function listing(dir: string): string[] {
	try {
		return fs.readdirSync(dir);
	} catch {
		return [];
	}
}

/** URL paths joined with single slashes and a leading one: `("api/", "/users", "{id}")` → `/api/users/{id}`. */
export const joinPath = (...parts: (string | undefined)[]) => '/' + parts.filter(x => x !== undefined && x !== '').map(x => x!.replace(/^\/+|\/+$/g, '')).filter(Boolean).join('/');
