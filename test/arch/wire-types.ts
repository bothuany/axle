// The extension host and the canvas each declare the shapes they exchange (FlowNode, EntryPoint, DbSchema). This file
// fails to compile when what the host sends stops fitting what the canvas reads. Checked by wire-types.test.mjs (`npm run arch`).
import type { DbSchema as UiDbSchema, EntryPoint as UiEntryPoint, FlowNode as UiFlowNode } from '../../ui/src/types';
import type { FlowNode as ProviderFlowNode } from '../../editor/extensions/flow-view/src/providers';
import type { FlowNode as PolyFlowNode } from '../../editor/extensions/flow-view/src/poly/graph';
import type { DbSchema as PolyDbSchema, EntryPoint as PolyEntryPoint } from '../../editor/extensions/flow-view/src/poly/model';
import type { EntryPoint as RoslynEntryPoint } from '../../editor/extensions/flow-view/src/analyzer';

type Fits<From extends To, To> = [From, To];

export type Checks = [
	Fits<ProviderFlowNode, UiFlowNode>,
	Fits<PolyFlowNode, UiFlowNode>,
	Fits<PolyEntryPoint, UiEntryPoint>,
	Fits<RoslynEntryPoint, UiEntryPoint>,
	Fits<PolyDbSchema, UiDbSchema>,
];
