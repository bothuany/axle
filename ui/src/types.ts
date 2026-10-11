export type Kind = 'controller' | 'handler' | 'method' | 'db' | 'ambiguous' | 'external'
export type EdgeKind = 'call' | 'mediator' | 'impl' | 'db'

export interface FlowNode {
  key: string
  symbolId: string | null
  label: string
  sub: string
  kind: Kind
  file: string | null
  startLine: number
  endLine: number
  code: string | null
  children: FlowEdge[]
  /** Agent change inside this method (current-file line numbers), when Axle is tracking one. */
  diff?: { added: number[]; removed: { after: number; lines: string[] }[]; plus: number; minus: number }
  /** Database cards: the table an EF query touches, read from the entity and its EF configuration. */
  schema?: DbSchema
}

export interface FlowEdge {
  callLine: number
  edgeKind: EdgeKind
  node: FlowNode
}

export interface EntryPoint {
  id: string
  controller: string
  action: string
  http: string
  file: string
  line: number
}

export interface DbColumn {
  name: string
  column: string
  type: string
  key: boolean
  nullable: boolean
  maxLength: number | null
}

export interface DbSchema {
  entity: string
  table: string
  dbSchemaName: string | null
  context: string
  columns: DbColumn[]
  relations: string[]
  /** Query operators in the order they run: AsNoTracking, Where, Select, FirstOrDefaultAsync… */
  ops: string[]
  writes: boolean
  file: string | null
  line: number
}
