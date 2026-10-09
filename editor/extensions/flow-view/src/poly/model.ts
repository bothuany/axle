/*---------------------------------------------------------------------------------------------
 *  Flow polyglot index: what each source file declares, in one shape for every language. The
 *  extractors (java.ts, python.ts, js.ts) fill it from tree-sitter trees; graph.ts resolves it.
 *--------------------------------------------------------------------------------------------*/

export type Lang = 'java' | 'python' | 'js';

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

export const EXCLUDED_DIRS = new Set([
	'node_modules', '.git', 'target', 'build', 'dist', 'out', 'bin', 'obj', '.venv', 'venv', 'env', '__pycache__',
	'.next', '.nuxt', 'coverage', 'vendor', 'bower_components', 'third_party', 'lib', 'libs', 'assets', 'static',
	'public', '.idea', '.vscode', '.gradle', '.mvn', '.claude', 'site-packages', '.tox', '.mypy_cache', '.pytest_cache',
]);

export function langOf(file: string): Lang | 'ts' | 'tsx' | undefined {
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
