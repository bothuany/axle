// What the board webview and its host (flow-view/src/boardPanel.ts) say to each other, and the look-up tables both the
// renderer and the SVG export use. Pure: no DOM, no React.
import type { BoardSpec, EdgeKind, NodeKind } from './spec'

/** What a rebuild asks the host for. Mirrors flow-view's BoardOptions: the host recomputes the board from these. */
export interface BoardOpts {
  query?: string
  focusId?: string
  depth?: number
  includeEntities?: boolean
  includeEnums?: boolean
  hideRoles?: string[]
  collapseLevel?: number
}

export type ExportFormat = 'mermaid' | 'plantuml' | 'png' | 'svg' | 'json'

export interface Bootstrap {
  spec: BoardSpec
  /** The host's name for the source that can rebuild this board ('dto', 'architecture'); absent: the board is fixed. */
  source?: string
  opts: BoardOpts
  dark: boolean
  /** 'local': the source ignores the query, so a search only highlights what is drawn (no rebuild). */
  search?: 'host' | 'local'
}

export type ToHost =
  | { type: 'ready' }
  | { type: 'open'; file: string; line: number }
  | { type: 'rebuild'; seq: number; kind: string; opts: BoardOpts }
  | { type: 'export'; format: ExportFormat; data?: string; name?: string }

export type ToWebview =
  /** `refresh`: the same board drawn again because the code changed: the search, selection and viewport stay as they are. */
  | { type: 'board'; spec: BoardSpec; opts?: BoardOpts; seq?: number; refresh?: boolean }
  | { type: 'error'; message: string; seq?: number }

/** Colour per node kind (the accent of a card). */
export const KIND_COLOR: Record<NodeKind, string> = {
  entry: '#ffb454',
  controller: '#ffb454',
  service: '#6f86ff',
  repository: '#4fd6d0',
  entity: '#e6c15a',
  dto: '#5fe0a1',
  enum: '#b88cff',
  interface: '#7cc4ff',
  class: '#8b93a1',
  external: '#5c6370',
  step: '#8b93a1',
  decision: '#ffb454',
  note: '#e6c15a',
  actor: '#b88cff',
}

export const STEREOTYPE: Partial<Record<NodeKind, string>> = {
  entry: 'handler',
  controller: 'controller',
  service: 'service',
  repository: 'repository',
  entity: 'entity',
  dto: 'dto',
  enum: 'enum',
  interface: 'interface',
  external: 'external',
}

export type Head = 'tri' | 'vee' | 'fill' | 'none'
export interface EdgeStyle {
  dash?: string
  head: Head
  /** One of the --fl-* colour names (text, muted, signal, add, del). */
  color: 'text' | 'muted' | 'signal' | 'add' | 'del'
}

export const EDGE_STYLE: Record<EdgeKind, EdgeStyle> = {
  extends: { head: 'tri', color: 'text' },
  implements: { head: 'tri', dash: '6 4', color: 'text' },
  has: { head: 'vee', color: 'signal' },
  'has-many': { head: 'vee', color: 'signal' },
  depends: { head: 'vee', dash: '6 4', color: 'muted' },
  uses: { head: 'vee', dash: '6 4', color: 'muted' },
  calls: { head: 'fill', color: 'muted' },
  next: { head: 'fill', color: 'muted' },
  yes: { head: 'fill', color: 'add' },
  no: { head: 'fill', color: 'del' },
  reads: { head: 'vee', dash: '3 3', color: 'muted' },
  writes: { head: 'fill', color: 'signal' },
  message: { head: 'fill', color: 'muted' },
}

export const edgeStyle = (kind: EdgeKind | undefined): EdgeStyle => EDGE_STYLE[kind ?? 'calls']

/** The kinds a role chip can hide, in the order they are shown. Entities and enums have their own toggles. */
export const ROLE_CHIPS: { role: NodeKind; label: string }[] = [
  { role: 'controller', label: 'controller' },
  { role: 'entry', label: 'handler' },
  { role: 'service', label: 'service' },
  { role: 'repository', label: 'repository' },
  { role: 'dto', label: 'dto' },
  { role: 'interface', label: 'interface' },
  { role: 'class', label: 'class' },
]

export const VISIBILITY_NAME = { '+': 'public', '-': 'private', '#': 'protected', '~': 'package' } as const
