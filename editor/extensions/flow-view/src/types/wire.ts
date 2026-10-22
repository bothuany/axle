/*---------------------------------------------------------------------------------------------
 *  Insilode type model: the shapes the two sources send. `GET /api/types` of the C# analyzer
 *  (analyzer/Types.cs writes exactly these names) and the code index's `typeFacts` (poly/graph.ts).
 *  Types only: both ends import them, nothing runs here.
 *--------------------------------------------------------------------------------------------*/

import type { FileFacts } from '../poly/model';

export interface CsParam {
	name: string;
	/** As written, one line, namespaces stripped by Roslyn's short format: `List<UserDto>`. */
	type: string;
	/** Fully qualified names of the source types it is made of, collections, Task, ActionResult and nullables unwrapped. */
	refs: string[];
	isCollection?: boolean;
	nullable?: boolean;
	/** Controller actions: where the argument comes from (FromBody, FromQuery, FromRoute, FromForm, FromHeader, FromServices). */
	source?: string;
}

export interface CsMember {
	name: string;
	kind: 'field' | 'property';
	type: string;
	refs: string[];
	isCollection: boolean;
	nullable: boolean;
	/** public, private, protected, internal, protected internal, private protected. */
	visibility: string;
	isStatic: boolean;
	line: number;
}

export interface CsMethod {
	name: string;
	/** `(string name, int age): UserDto` */
	signature: string;
	returnType: string;
	returnRefs: string[];
	returnIsCollection?: boolean;
	parameters: CsParam[];
	visibility: string;
	isStatic: boolean;
	isAbstract?: boolean;
	attributes?: string[];
	line: number;
	endLine: number;
}

export interface CsType {
	/** Namespace-qualified, nested types as `Outer.Inner`. */
	fqn: string;
	name: string;
	namespace: string;
	/** The project (assembly) the file belongs to. */
	project: string;
	kind: 'class' | 'interface' | 'struct' | 'record' | 'enum';
	file: string;
	line: number;
	endLine: number;
	/** Fully qualified name of the base class when it is a source type, else its short name; absent for System.Object. */
	baseType?: string;
	/** Same, for the interfaces. */
	interfaces: string[];
	/** Attribute names without the `Attribute` suffix. */
	attributes: string[];
	isAbstract: boolean;
	isStatic: boolean;
	typeParameters: string[];
	fields: CsMember[];
	methods: CsMethod[];
	/** The primary constructor's, or the biggest constructor's parameters: what the container injects. */
	constructorParameters: CsParam[];
	enumMembers: string[];
}

export interface CsEntry {
	/** The entry point id the flow uses (`EntryPoint.id`). */
	id: string;
	/** Fully qualified name of the controller. */
	controller: string;
	action: string;
	http: string;
	file: string;
	line: number;
	parameters: CsParam[];
	returnType: string;
	returnRefs: string[];
	returnIsCollection?: boolean;
}

export interface CsTypesResponse {
	types: CsType[];
	entries: CsEntry[];
	/** True when the analyzer cut the list (more than its cap). */
	truncated?: boolean;
}

/** What the index knows about one entry point, with the declared types of its parameters. */
export interface PolyEntryFact {
	id: string;
	controller: string;
	action: string;
	http: string;
	file: string;
	line: number;
	owner?: string;
	params: { name: string; typeText: string; anns: string[] }[];
	returns?: string;
}

export interface PolyTypeFacts {
	files: FileFacts[];
	calls: { fromFile: string; fromOwner: string; toFile: string; toOwner: string; count: number }[];
	entries: PolyEntryFact[];
}
