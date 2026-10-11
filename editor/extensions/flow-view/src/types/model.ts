/*---------------------------------------------------------------------------------------------
 *  Axle type model: every type of the workspace (classes, interfaces, enums, records, structs)
 *  with its fields and methods, where each field and method signature points at other types of
 *  the workspace by id. Built from the polyglot facts and the C# analyzer; the DTO relation
 *  board, the architecture board and the type chips on cards are all drawn from this one graph.
 *  Pure data, no vscode, no fs.
 *--------------------------------------------------------------------------------------------*/

export type TypeKind = 'class' | 'interface' | 'enum' | 'record' | 'struct';

/**
 * What a type is for. Decides where it sits in the architecture board and whether it is a DTO:
 * `enum` and `interface` follow the kind unless a stronger role (a repository interface) applies.
 */
export type TypeRole = 'controller' | 'handler' | 'service' | 'repository' | 'entity' | 'dto' | 'enum' | 'interface' | 'class';

export type TypeLang = 'java' | 'js' | 'python' | 'csharp' | 'go' | 'php' | 'ruby' | 'rust';

/** How many of the referenced type a field holds. */
export type Collection = 'one' | 'many' | 'optional';

export type Visibility = '+' | '-' | '#' | '~';

export interface SuperRef {
	/** As written (simple name). */
	name: string;
	/** The workspace type it resolves to; absent for framework or unresolved supers. */
	id?: string;
	relation: 'extends' | 'implements';
}

export interface FieldInfo {
	name: string;
	/** The declared type as written, on one line: `Map<String, List<UserDto>>`. */
	type: string;
	visibility: Visibility;
	isStatic: boolean;
	/** Workspace types the declared type is made of (collections, optionals and wrappers unwrapped; framework types dropped). */
	refs: string[];
	collection: Collection;
	nullable?: boolean;
	line?: number;
}

export interface MethodInfo {
	name: string;
	/** `(String name, int age): UserDto`, or `(...)` for a constructor. */
	signature: string;
	visibility: Visibility;
	isStatic: boolean;
	/** Workspace types in the parameters and the return type. */
	refs: string[];
	paramRefs: string[];
	returnRefs: string[];
	/** Wrappers and collections unwrapped: `ResponseEntity<List<UserDto>>` → many. */
	returnCollection?: Collection;
	/** Parameters bound from the request body (@RequestBody and friends): the types a client sends. */
	bodyRefs?: string[];
	line?: number;
	endLine?: number;
	/** Annotation simple names (GetMapping, Transactional). */
	annotations?: string[];
	isConstructor?: boolean;
	isAbstract?: boolean;
	/** getName() { return name; }: plumbing that boards leave out. */
	isAccessor?: boolean;
}

export interface TypeInfo {
	/** Stable: `lang:qualifiedName`, e.g. `java:com.acme.dto.UserDto`. */
	id: string;
	name: string;
	qualifiedName: string;
	kind: TypeKind;
	lang: TypeLang;
	file: string;
	line: number;
	endLine: number;
	/** The module/microservice/project: the nearest folder with a build manifest (a .csproj for C#), else the workspace folder. Its name. */
	module: string;
	/** Java package, C# namespace, Python module, JS folder: the finer grouping inside a module. */
	packageName: string;
	role: TypeRole;
	isDto: boolean;
	/** Why it is or is not a DTO, always set: `name suffix Dto`, `record`, `@RequestBody of UserController.create`, `referenced by UserDto`, `entity (@Entity)`. */
	dtoReason: string;
	isAbstract: boolean;
	supers: SuperRef[];
	typeParams: string[];
	annotations: string[];
	fields: FieldInfo[];
	methods: MethodInfo[];
	/** Enum constants. */
	constants?: string[];
	/** Types a constructor takes (constructor injection), ids of workspace types: the DI edges. */
	ctorDeps: string[];
	/** Spring/Lombok-style: the class has generated accessors, so its fields are its shape and no accessor is listed. */
	generatedAccessors?: boolean;
}

/** The name the type graph is described with in the contracts: a node of the graph. */
export type TypeNode = TypeInfo;

/** Call sites from one class to another (from the flow index), already mapped to type ids. */
export interface TypeCallEdge {
	from: string;
	to: string;
	count: number;
}

export interface ModuleInfo {
	/** Folder (or project) name; also the group id suffix. */
	name: string;
	/** Absolute folder when known. */
	root?: string;
	types: number;
}

/** An endpoint with the types it takes and returns, for the type chips on endpoint cards. */
export interface EndpointTypes {
	/** The flow id of the entry (`poly:file#Owner.name@line` or the analyzer's id). */
	id: string;
	/** Owning type id when it resolves. */
	owner?: string;
	controller: string;
	action: string;
	http: string;
	file: string;
	line: number;
	params: { name: string; type: string; refs: string[]; collection: Collection; body?: boolean }[];
	returnType?: string;
	returnRefs: string[];
	returnCollection: Collection;
}

/** One parameter type or return type of a function, as the chips on its card show it. */
export interface SigType {
	/** As declared, packages stripped. */
	type: string;
	/** Workspace types it is made of (collections, optionals and response wrappers unwrapped), type ids. */
	refs: string[];
	collection: Collection;
}

/** A function or method with the workspace types of its signature, found by the file and line its declaration starts at (a card's `file:startLine`). */
export interface FuncSig {
	file: string;
	line: number;
	endLine?: number;
	name: string;
	/** Name of the owning type, as the code index or the analyzer says. */
	owner?: string;
	params: (SigType & { name: string })[];
	returns?: SigType;
}

/** How a type points at another one. */
export interface TypeEdge {
	from: string;
	to: string;
	/** field: a field's type; method: a parameter or return type; ctor: constructor injection; generic: a type argument of a super (`JpaRepository<User, Long>`); extends / implements: from supers. */
	via: 'field' | 'method' | 'ctor' | 'generic' | 'extends' | 'implements';
	/** The field or method name(s). */
	names: string[];
	collection: Collection;
}

/** What decides roles and DTOs; the host fills it from the `flow.types` settings (see `classifyOptions`). */
export interface ClassifyOptions {
	/** A type whose name ends with one of these is a DTO. */
	dtoSuffixes: string[];
	/** The DTO board draws entities too. */
	includeEntities: boolean;
	/** The DTO board draws the enums its types refer to. */
	includeEnums: boolean;
}

export interface TypeGraph {
	options: ClassifyOptions;
	/** Sorted by id. */
	types: TypeInfo[];
	byId: Map<string, TypeInfo>;
	/** Every reference between two types (one per from, to and via), sorted. */
	edges: TypeEdge[];
	modules: ModuleInfo[];
	calls: TypeCallEdge[];
	endpoints: EndpointTypes[];
	/** Functions whose signature names a workspace type: the type chips of the cards. */
	funcs: FuncSig[];
}

export const ROLES: readonly TypeRole[] = ['controller', 'handler', 'service', 'repository', 'entity', 'dto', 'interface', 'class', 'enum'];

/** Code-unit comparison: boards must not depend on the machine's locale. */
export const byCode = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/** A short name for a module group id. */
export const moduleGroupId = (module: string) => `mod:${module}`;
export const packageGroupId = (module: string, pkg: string) => `pkg:${module}:${pkg}`;
export const roleGroupId = (module: string, role: string) => `role:${module}:${role}`;
