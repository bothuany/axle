/*---------------------------------------------------------------------------------------------
 *  Insilode type model: what a type is for. Roles (controller, handler, service, repository,
 *  entity, dto, interface, enum, class) and the DTO heuristic, written down in one place so it
 *  can be read, configured and tested: name suffixes, data-only shapes (records, dataclasses,
 *  Pydantic models, structs with only fields), and the types an endpoint takes or returns.
 *  Pure: no vscode, no fs.
 *--------------------------------------------------------------------------------------------*/

import type { ClassifyOptions, TypeKind, TypeLang, TypeRole } from './model';

export const DEFAULT_DTO_SUFFIXES: readonly string[] = ['Dto', 'DTO', 'Request', 'Response', 'Command', 'Query', 'Result', 'Model', 'ViewModel', 'Payload', 'Input', 'Output', 'Params', 'Args', 'Event', 'Message', 'Resource', 'Vm'];

export const DEFAULT_CLASSIFY: ClassifyOptions = { dtoSuffixes: [...DEFAULT_DTO_SUFFIXES], includeEntities: false, includeEnums: true };

/** Options from loose input (a settings object): bad or missing values fall back to the defaults. */
export function classifyOptions(input?: { dtoSuffixes?: unknown; includeEntities?: unknown; includeEnums?: unknown }): ClassifyOptions {
	const suffixes = Array.isArray(input?.dtoSuffixes) ? input!.dtoSuffixes.filter((s): s is string => typeof s === 'string' && /^[A-Za-z][A-Za-z0-9_]*$/.test(s)) : undefined;
	return {
		dtoSuffixes: suffixes?.length ? suffixes : [...DEFAULT_DTO_SUFFIXES],
		includeEntities: typeof input?.includeEntities === 'boolean' ? input.includeEntities : DEFAULT_CLASSIFY.includeEntities,
		includeEnums: typeof input?.includeEnums === 'boolean' ? input.includeEnums : DEFAULT_CLASSIFY.includeEnums,
	};
}

/** What the heuristics look at, in one shape for every language. */
export interface ClassifyFacts {
	name: string;
	kind: TypeKind;
	lang: TypeLang;
	/** Alias of an object type (TS `type X = { ... }`). */
	alias?: boolean;
	isAbstract: boolean;
	/** Annotation, decorator and attribute simple names. */
	annotations: string[];
	/** Base type and interface names, simple. */
	supers: string[];
	/** Field names (non-static). */
	fields: { name: string; visibility: string; isStatic: boolean }[];
	/** Method names except constructors. */
	methods: string[];
	/** Declares a constructor that takes workspace types (constructor injection). */
	injects: boolean;
	/** An endpoint is declared on it. */
	hasEndpoints: boolean;
	/** Mapped by an ORM context (EF Core DbSet<T>) or listed as a model elsewhere. */
	mappedEntity: boolean;
	/** Has fields declared with an ORM column call (SQLAlchemy `Column(...)`, `mapped_column`, `relationship`). */
	ormFields?: boolean;
}

const has = (list: readonly string[], ...names: string[]) => names.some(n => list.includes(n));

const ENTITY_ANN = ['Entity', 'Table', 'MappedSuperclass', 'Embeddable', 'Document'];
const CONTROLLER_ANN = ['Controller', 'RestController', 'ApiController', 'RestControllerAdvice', 'ControllerAdvice', 'Path', 'RequestMapping', 'Route', 'RoutePrefix', 'WebServlet', 'ApiVersion', 'Resolver'];
const CONTROLLER_BASES = ['Controller', 'ControllerBase', 'ApiController', 'APIView', 'ViewSet', 'ModelViewSet', 'GenericAPIView', 'View', 'HttpServlet', 'Hub', 'MethodView', 'BaseController'];
const HANDLER_ANN = ['KafkaListener', 'RabbitListener', 'JmsListener', 'SqsListener', 'StreamListener', 'EventHandler', 'Processor', 'Consumer', 'EventPattern', 'MessagePattern', 'OnEvent', 'Scheduled', 'Subscribe'];
const HANDLER_BASES = ['IRequestHandler', 'INotificationHandler', 'IEventHandler', 'IHandler', 'RequestHandler', 'IConsumer', 'IHostedService', 'BackgroundService', 'ICommandHandler', 'IQueryHandler', 'Runnable', 'ApplicationListener', 'MessageListener', 'WorkerHost', 'EventSubscriber'];
const SERVICE_ANN = ['Service', 'Component', 'Injectable', 'Singleton', 'ApplicationScoped', 'RequestScoped', 'Named', 'Provider', 'Configuration'];
const SERVICE_SUFFIX = ['Service', 'ServiceImpl', 'Manager', 'Facade', 'UseCase', 'Provider', 'Gateway', 'Client', 'Helper', 'Factory', 'Validator', 'Mapper', 'Converter'];
const HANDLER_SUFFIX = ['Handler', 'Consumer', 'Listener', 'Subscriber', 'Processor', 'Worker', 'Job'];
const REPOSITORY_ANN = ['Repository', 'EntityRepository', 'Dao'];
const REPOSITORY_BASES = ['JpaRepository', 'CrudRepository', 'PagingAndSortingRepository', 'MongoRepository', 'Repository', 'ReactiveCrudRepository', 'R2dbcRepository', 'ElasticsearchRepository', 'ListCrudRepository', 'DbContext', 'IdentityDbContext', 'IRepository', 'IReadRepository', 'IUnitOfWork', 'PanacheRepository', 'BaseRepository'];
const REPOSITORY_SUFFIX = ['Repository', 'Repo', 'Dao', 'DAO', 'DbContext', 'Store'];
/** Base classes that make a Python or PHP class a table. */
const ENTITY_BASES = ['Model', 'DeclarativeBase', 'AbstractUser', 'AbstractBaseUser', 'BaseEntity'];

const stem = (name: string) => name.replace(/<.*$/, '');
/** `UserService` ends with the word `Service`; `Service` alone is that word too. */
const endsWithWord = (name: string, word: string) => name === word || (name.length > word.length && name.endsWith(word) && /[a-z0-9]/.test(name[name.length - word.length - 1]));

/** Mapped to a table by what is written on it (an annotation, a base class, ORM column fields), not by its name. */
function isEntity(f: ClassifyFacts): boolean {
	if (f.mappedEntity || has(f.annotations, ...ENTITY_ANN)) {
		return true;
	}
	if ((f.lang === 'python' || f.lang === 'php') && has(f.supers, ...ENTITY_BASES)) {
		return true;
	}
	if (f.lang === 'python' && f.ormFields && has(f.supers, 'Base', 'SQLModel')) {
		return true;
	}
	return f.lang === 'ruby' && has(f.supers, 'ApplicationRecord', 'ActiveRecord::Base');
}

/** The role of a type. Entity wins over everything (an @Entity named OrderService is still a table), then the architecture roles, then the kind. */
export function roleOf(f: ClassifyFacts): TypeRole {
	const name = stem(f.name);
	if (isEntity(f)) {
		return 'entity';
	}
	if (f.kind === 'enum') {
		return 'enum';
	}
	if (f.hasEndpoints || has(f.annotations, ...CONTROLLER_ANN) || has(f.supers, ...CONTROLLER_BASES) || endsWithWord(name, 'Controller') || endsWithWord(name, 'ViewSet') || (f.lang === 'python' && endsWithWord(name, 'View'))) {
		return 'controller';
	}
	if (has(f.annotations, ...REPOSITORY_ANN) || has(f.supers, ...REPOSITORY_BASES) || REPOSITORY_SUFFIX.some(s => endsWithWord(name, s))) {
		return 'repository';
	}
	if (has(f.annotations, ...HANDLER_ANN) || has(f.supers, ...HANDLER_BASES) || HANDLER_SUFFIX.some(s => endsWithWord(name, s)) || f.supers.some(s => /Handler$/.test(s))) {
		return 'handler';
	}
	if (has(f.annotations, ...SERVICE_ANN) || SERVICE_SUFFIX.some(s => endsWithWord(name, s))) {
		return 'service';
	}
	if (f.kind === 'interface') {
		return 'interface';
	}
	return 'class';
}

const TRIVIAL = /^(get|set|is|has|to_string|toString|equals|hashCode|compareTo|__str__|__repr__|__eq__|__hash__|__post_init__|__init__|constructor|String|Error|MarshalJSON|UnmarshalJSON|clone|copy|with|from|of|builder|build|dict|json|model_dump|model_validate|validate|Validate)([A-Z_].*)?$/;

/**
 * Why a type, whatever the role, has the shape of a data carrier, or undefined when it does not. Languages say it in different ways:
 * Java and C# records, Lombok `@Data`, Python `BaseModel` and `@dataclass`, TypedDict, Go and Rust structs that only hold fields,
 * TS interfaces and object aliases, PHP classes with only public properties.
 */
export function dataShape(f: ClassifyFacts): string | undefined {
	if (f.kind === 'enum') {
		return undefined;
	}
	if (f.kind === 'record') {
		return 'record';
	}
	if (has(f.annotations, 'Data', 'Value', 'Getter', 'Setter', 'Builder') && f.lang === 'java' && !has(f.annotations, 'Service', 'Component', 'Repository', 'Entity', 'Controller', 'RestController')) {
		const hit = f.annotations.find(a => a === 'Data' || a === 'Value') ?? f.annotations.find(a => a === 'Getter' || a === 'Setter' || a === 'Builder');
		return `@${hit}`;
	}
	if (f.lang === 'python') {
		if (has(f.supers, 'BaseModel', 'BaseSettings', 'SQLModel', 'Schema', 'Struct')) {
			return `${f.supers.find(s => ['BaseModel', 'BaseSettings', 'SQLModel', 'Schema', 'Struct'].includes(s))} subclass`;
		}
		if (has(f.supers, 'TypedDict', 'NamedTuple')) {
			return f.supers.includes('TypedDict') ? 'TypedDict' : 'NamedTuple';
		}
		if (has(f.annotations, 'dataclass', 'dataclasses.dataclass', 'attr.s', 'attrs', 'define', 'frozen')) {
			return 'dataclass';
		}
	}
	if (f.lang === 'js' && (f.kind === 'interface' || f.alias) && f.fields.length && !f.methods.length) {
		return f.alias ? 'type alias of an object' : 'TS interface of fields';
	}
	const data = f.fields.filter(x => !x.isStatic);
	const logic = f.methods.filter(m => !TRIVIAL.test(m));
	if (f.kind === 'interface' || f.isAbstract) {
		return undefined;
	}
	if (f.lang === 'go' || f.lang === 'rust' || f.kind === 'struct') {
		if (data.length && !logic.length) {
			return `${f.lang === 'go' ? 'Go ' : f.lang === 'rust' ? 'Rust ' : ''}struct with only fields`;
		}
		return undefined;
	}
	if (f.lang === 'php' && data.length && data.every(x => x.visibility === '+') && !logic.length) {
		return 'class with only public properties';
	}
	// Java, C# and the rest: nothing but fields and plumbing. A class that takes services in its constructor is not data.
	if (data.length && !logic.length && !f.injects && f.lang !== 'js' && f.lang !== 'php' && f.lang !== 'ruby') {
		return 'only fields and accessors';
	}
	return undefined;
}

/** The suffix a name is a DTO by, if any. A bare suffix (a class named `Event`) counts too. */
export function dtoSuffix(name: string, suffixes: readonly string[]): string | undefined {
	const n = stem(name);
	return [...suffixes].sort((a, b) => b.length - a.length).find(s => n === s || (n.length > s.length && n.endsWith(s) && (/[a-z0-9_]$/.test(n.slice(0, -s.length)) || s === s.toUpperCase())));
}

/** Roles whose types are never DTOs, whatever they are named: they do things. */
export const BEHAVIOUR_ROLES: readonly TypeRole[] = ['controller', 'handler', 'service', 'repository'];

/**
 * The first reason that makes a type of this role a DTO on its own (no graph needed): name suffix, then data shape.
 * The graph adds the types that endpoints take or return and what DTO fields refer to.
 */
export function dtoOwnReason(f: ClassifyFacts, role: TypeRole, opts: ClassifyOptions): string | undefined {
	if (role === 'entity' || role === 'enum' || BEHAVIOUR_ROLES.includes(role)) {
		return undefined;
	}
	const suffix = dtoSuffix(f.name, opts.dtoSuffixes);
	if (suffix) {
		return `name suffix ${suffix}`;
	}
	return dataShape(f);
}
