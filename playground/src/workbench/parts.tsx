// Small pieces the workbench's views share: codicons (the icon font VS Code itself uses), file icons, the file tree of the demo project.
import type { CSSProperties, MouseEvent, ReactNode } from 'react'

/** A codicon, the way the workbench draws it. */
export function Ci({ name, className = '', style }: { name: string; className?: string; style?: CSSProperties }) {
  return <i className={`codicon codicon-${name} ci ${className}`} style={style} aria-hidden="true" />
}

/** A toolbar button: an icon, a tooltip and an accessible name. */
export function Tb({ icon, title, onClick, src }: { icon?: string; title: string; onClick?: (e: MouseEvent) => void; src?: string }) {
  return (
    <button type="button" className="tb" title={title} aria-label={title} onClick={onClick}>
      {src ? <img src={src} alt="" /> : <Ci name={icon ?? 'circle'} />}
    </button>
  )
}

const KINDS: Record<string, { text: string; color: string }> = {
  java: { text: 'J', color: '#cc3e44' },
  py: { text: 'py', color: '#519aba' },
  md: { text: 'i', color: '#519aba' },
  json: { text: '{}', color: '#cbcb41' },
}
const extOf = (name: string) => (name.includes('.') ? name.slice(name.lastIndexOf('.') + 1) : '')

/** The file icon of the default icon theme: a coloured mark for the language. */
export function FileIcon({ name }: { name: string }) {
  const k = KINDS[extOf(name)] ?? { text: '≡', color: '#8a8a8a' }
  return (
    <span className="fico" style={{ color: k.color }}>
      {k.text}
    </span>
  )
}

export interface TreeNode {
  name: string
  path: string
  children?: TreeNode[]
}

/** The project's paths as a tree: folders first, then files, each alphabetical (the Explorer's order). */
export function buildTree(paths: string[]): TreeNode[] {
  const root: TreeNode = { name: '', path: '', children: [] }
  for (const p of paths) {
    let at = root
    const parts = p.split('/')
    parts.forEach((part, i) => {
      const path = parts.slice(0, i + 1).join('/')
      at.children ??= []
      let next = at.children.find(c => c.name === part)
      if (!next) {
        next = i === parts.length - 1 ? { name: part, path } : { name: part, path, children: [] }
        at.children.push(next)
      }
      at = next
    })
  }
  const order = (n: TreeNode) => {
    n.children?.sort((a, b) => Number(!!b.children) - Number(!!a.children) || a.name.localeCompare(b.name, 'en'))
    n.children?.forEach(order)
  }
  order(root)
  return root.children ?? []
}

/** Folders that hold a single folder show as one row, `src/main/java`, as the Explorer does with compact folders. */
export function compact(node: TreeNode): TreeNode {
  if (!node.children) return node
  let n = node
  let name = node.name
  while (n.children?.length === 1 && n.children[0].children) {
    n = n.children[0]
    name += `/${n.name}`
  }
  return { ...n, name, children: n.children?.map(compact) }
}

export function Pane({ title, open, onToggle, actions, children }: { title: string; open: boolean; onToggle: () => void; actions?: ReactNode; children?: ReactNode }) {
  return (
    <>
      <div className="pane-h" role="button" tabIndex={0} aria-expanded={open} onClick={onToggle} onKeyDown={e => (e.key === 'Enter' || e.key === ' ') && onToggle()}>
        <span className="tw">
          <Ci name={open ? 'chevron-down' : 'chevron-right'} />
        </span>
        <span>{title}</span>
        <span className="grow" />
        {actions}
      </div>
      {open && children}
    </>
  )
}
