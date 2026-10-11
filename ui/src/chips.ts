// Type chips on the cards: the workspace types in a method's signature, and what opens under a chip (the type's fields, each of which can open again).
// Pure: the rows a card shows are computed here, so layout.ts counts exactly the rows nodes.tsx draws.

export type Cardinality = 'one' | 'many' | 'optional'

/** A parameter (`name` is its name) or the return value (`name` is empty) whose type is a workspace type. */
export interface ChipItem {
  name: string
  /** The declared type: `Task<ActionResult<List<OrderDto>>>`. */
  ref: string
  typeId: string
  typeName: string
  kind: string
  role: string
  file: string
  line: number
  collection: Cardinality
}

export interface CardChips {
  params: ChipItem[]
  returns?: ChipItem
}

/** A workspace type a chip or a field names. */
export interface TypeLink {
  id: string
  name: string
  kind: string
  role: string
  file: string
  line: number
}

export interface TreeField {
  name: string
  type: string
  card: Cardinality
  ref?: TypeLink
}

/** The host's answer for one opened type: its fields (one level) and, for an enum, its constants. */
export interface TypeTree extends TypeLink {
  constants?: string[]
  moreConstants?: number
  fields: TreeField[]
  moreFields?: number
}

export type Detail = TypeTree | 'loading' | 'missing'

/** What the canvas knows about chips, handed to the layout: chips by `file:line` of the card, the opened paths by card key, the fields of the types read so far. */
export interface ChipsView {
  byPlace: Readonly<Record<string, CardChips>>
  open: Readonly<Record<string, readonly string[]>>
  details: ReadonlyMap<string, Detail>
}

export const NO_CHIPS: ChipsView = { byPlace: {}, open: {}, details: new Map() }

export const placeOf = (node: { file: string | null; startLine: number }) => `${node.file}:${node.startLine}`

/** The chips strip, and one row of an opened tree. */
export const STRIP_H = 26
export const ROW_H = 20
const TREE_PAD = 8
/** Fields (or enum constants) listed before "+N more". */
export const MAX_ROWS = 12
/** Types deep: the chip's type is level 1; a field's type of it 2, and so on. Past this a field only links to its type. */
export const MAX_LEVEL = 4

export type ChipRow =
  | { kind: 'head'; path: string; type: TypeLink }
  | { kind: 'field'; path: string; level: number; field: TreeField; open: boolean; /** The type is already open above it. */ cycle: boolean; /** Too deep to open. */ limit: boolean }
  | { kind: 'const'; level: number; name: string }
  | { kind: 'more'; level: number; count: number; type: TypeLink }
  | { kind: 'note'; level: number; text: string }

export const linkOf = (c: ChipItem): TypeLink => ({ id: c.typeId, name: c.typeName, kind: c.kind, role: c.role, file: c.file, line: c.line })

/** The top-level chips in the order they are drawn, with the path that names each (`p0`, `p1`, `r`). */
export function chipList(chips: CardChips): { path: string; item: ChipItem }[] {
  return [...chips.params.map((item, i) => ({ path: `p${i}`, item })), ...(chips.returns ? [{ path: 'r', item: chips.returns }] : [])]
}

/** The rows under the strip: for each opened chip its type and the fields of it, and below an opened field the fields of its type. */
export function chipRows(chips: CardChips, open: ReadonlySet<string>, details: ReadonlyMap<string, Detail>): ChipRow[] {
  const out: ChipRow[] = []
  const expand = (type: TypeLink, path: string, level: number, above: ReadonlySet<string>) => {
    const d = details.get(type.id)
    if (!d || d === 'loading') return void out.push({ kind: 'note', level, text: 'Reading…' })
    if (d === 'missing') return void out.push({ kind: 'note', level, text: 'This type is no longer in the workspace.' })
    if (d.kind === 'enum') {
      const shown = (d.constants ?? []).slice(0, MAX_ROWS)
      shown.forEach(name => out.push({ kind: 'const', level, name }))
      const more = (d.constants?.length ?? 0) - shown.length + (d.moreConstants ?? 0)
      if (more > 0) out.push({ kind: 'more', level, count: more, type: d })
      return
    }
    const here = new Set([...above, type.id])
    d.fields.slice(0, MAX_ROWS).forEach((field, i) => {
      const p = `${path}/${i}`
      const cycle = !!field.ref && here.has(field.ref.id)
      const limit = !!field.ref && !cycle && level >= MAX_LEVEL
      const isOpen = !!field.ref && !cycle && !limit && open.has(p)
      out.push({ kind: 'field', path: p, level, field, open: isOpen, cycle, limit })
      if (isOpen) expand(field.ref!, p, level + 1, here)
    })
    const more = d.fields.length - MAX_ROWS + (d.moreFields ?? 0)
    if (more > 0) out.push({ kind: 'more', level, count: more, type: d })
    if (!d.fields.length) out.push({ kind: 'note', level, text: 'No fields.' })
  }
  for (const { path, item } of chipList(chips)) {
    if (!open.has(path)) continue
    const type = linkOf(item)
    out.push({ kind: 'head', path, type })
    expand(type, path, 1, new Set())
  }
  return out
}

/** The room the chips take on a card: the strip, and the rows of what is opened. */
export const chipsHeight = (rows: number) => STRIP_H + (rows ? rows * ROW_H + TREE_PAD : 0)

/** The chips of a card, their open rows and how tall they make the card. Not on cards that show no method source (database, outside, ambiguous). */
export function chipsFor(node: { key: string; file: string | null; startLine: number }, view: ChipsView) {
  const chips = node.file ? view.byPlace[placeOf(node)] : undefined
  if (!chips) return undefined
  const open = new Set(view.open[node.key] ?? [])
  const rows = chipRows(chips, open, view.details)
  return { chips, open, rows, h: chipsHeight(rows.length) }
}
