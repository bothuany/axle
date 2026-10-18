// The sidebar's views: Explorer, Axle's endpoint list, Source Control, and the simple ones (Search, Run and Debug, Extensions).
import { useMemo, useState } from 'react'
import { serviceOf } from '../demo'
import { Ci, FileIcon, Pane, Tb, buildTree, compact, type TreeNode } from './parts'
import { changedFiles, demo, entries, openEntry, openFile, useWorkbench } from './store'

// ---- Explorer ---------------------------------------------------------------------------------------------------------

function Node({ node, depth, open, toggle, active, onOpen, modified }: { node: TreeNode; depth: number; open: Set<string>; toggle: (p: string) => void; active?: string; onOpen: (p: string) => void; modified: Set<string> }) {
  const folder = !!node.children
  const isOpen = open.has(node.path)
  const changed = folder ? [...modified].some(m => m.startsWith(`${node.path}/`)) : modified.has(node.path)
  return (
    <>
      <div className={`row${active === node.path ? ' sel' : ''}${changed ? ' m' : ''}`} style={{ paddingLeft: 4 + depth * 8 }} role="treeitem" aria-expanded={folder ? isOpen : undefined} onClick={() => (folder ? toggle(node.path) : onOpen(node.path))}>
        <span className="tw">{folder && <Ci name={isOpen ? 'chevron-down' : 'chevron-right'} />}</span>
        {!folder && <FileIcon name={node.name} />}
        <span className="label">{node.name}</span>
        <span className="grow" />
        {changed && (folder ? <span className="dot" /> : <span className="gm">M</span>)}
      </div>
      {folder && isOpen && node.children!.map(c => <Node key={c.path} node={compact(c)} depth={depth + 1} open={open} toggle={toggle} active={active} onOpen={onOpen} modified={modified} />)}
    </>
  )
}

export function Explorer() {
  const files = demo().files
  const tree = useMemo(() => buildTree(files.map(f => f.path)).map(compact), [files])
  const [open, setOpen] = useState<Set<string>>(() => new Set(['', 'orders-service', 'orders-service/src/main/java/com/harborgoods/orders']))
  const [outline, setOutline] = useState(false)
  const [timeline, setTimeline] = useState(false)
  const edited = useWorkbench(s => s.edited)
  const active = useWorkbench(s => s.codeTabs.find(t => t.id === s.activeCode)?.path)
  const modified = useMemo(() => new Set(changedFiles(edited).map(f => f.path)), [edited])
  const toggle = (p: string) => setOpen(o => { const n = new Set(o); if (n.has(p)) n.delete(p); else n.add(p); return n })
  return (
    <>
      <div className="viewtitle">
        <span className="grow">Explorer</span>
        <Tb icon="ellipsis" title="Views and More Actions…" />
      </div>
      <div className="viewbody" role="tree">
        <div className="row" style={{ paddingLeft: 4, fontWeight: 600, fontSize: 11 }} onClick={() => toggle('')}>
          <span className="tw"><Ci name={open.has('') ? 'chevron-down' : 'chevron-right'} /></span>
          <span className="label">harbor-goods</span>
        </div>
        {open.has('') && tree.map(n => <Node key={n.path} node={n} depth={1} open={open} toggle={toggle} active={active} onOpen={p => openFile(p)} modified={modified} />)}
        <Pane title="Outline" open={outline} onToggle={() => setOutline(o => !o)}><div className="pempty">The active editor cannot provide outline information.</div></Pane>
        <Pane title="Timeline" open={timeline} onToggle={() => setTimeline(o => !o)}><div className="pempty">The active editor cannot provide timeline information.</div></Pane>
      </div>
    </>
  )
}

// ---- Axle: Endpoints ---------------------------------------------------------------------------------------------------

export function Endpoints() {
  const list = useWorkbench(s => entries(s))
  const [filter, setFilter] = useState('')
  const [closed, setClosed] = useState<Set<string>>(new Set())
  const shown = list.filter(e => `${e.http} ${e.controller} ${e.action}`.toLowerCase().includes(filter.toLowerCase()))
  const groups = new Map<string, typeof list>()
  for (const e of [...shown].sort((a, b) => (serviceOf(a) + a.controller).localeCompare(serviceOf(b) + b.controller, 'en'))) groups.set(e.controller, [...(groups.get(e.controller) ?? []), e])
  return (
    <>
      <div className="viewtitle">
        <span className="grow">Axle: Endpoints</span>
        <Tb icon="collapse-all" title="Collapse All" />
        <Tb icon="type-hierarchy" title="Group by Service" />
      </div>
      <div className="viewbody">
        <div style={{ padding: '0 8px 4px' }}>
          <input className="filter" placeholder="Filter by name, verb or controller" value={filter} onChange={e => setFilter(e.target.value)} aria-label="Filter endpoints" />
        </div>
        <div className="row" style={{ paddingLeft: 10, fontSize: 12, color: 'var(--vscode-descriptionForeground)', cursor: 'default' }}>{list.length} endpoints</div>
        {[...groups].map(([name, items]) => (
          <div key={name}>
            <div className="row" style={{ paddingLeft: 4, fontWeight: 600 }} onClick={() => setClosed(c => { const n = new Set(c); if (n.has(name)) n.delete(name); else n.add(name); return n })}>
              <span className="tw"><Ci name={closed.has(name) ? 'chevron-right' : 'chevron-down'} /></span>
              <span className="label">{name}</span>
              <span className="grow" />
              <span className="count">{items.length}</span>
            </div>
            {!closed.has(name) && items.map(e => {
              const [verb, ...rest] = e.http.split(' ')
              return (
                <div key={e.id} className="row" style={{ paddingLeft: 24 }} onClick={() => openEntry(e)} title={`${e.http}\n${serviceOf(e)} · ${e.controller}.${e.action}`}>
                  <span className={`verb ${verb.toLowerCase()}`}>{verb}</span>
                  <span className="label" style={{ color: 'var(--vscode-foreground)' }}>{e.action}</span>
                  {rest.length > 0 && verb !== 'POST' && verb !== 'GET' ? <span className="desc">{rest.join(' ')}</span> : null}
                </div>
              )
            })}
          </div>
        ))}
      </div>
    </>
  )
}

// ---- Source Control ----------------------------------------------------------------------------------------------------

export function SourceControl() {
  const edited = useWorkbench(s => s.edited)
  const files = changedFiles(edited)
  const [graph, setGraph] = useState(true)
  return (
    <>
      <div className="viewtitle">
        <span className="grow">Source Control</span>
        <Tb icon="ellipsis" title="Views and More Actions…" />
      </div>
      <div className="viewbody" style={{ display: 'flex', flexDirection: 'column' }}>
        <div className="row" style={{ paddingLeft: 4, fontWeight: 600, fontSize: 11 }}>
          <span className="tw"><Ci name="chevron-down" /></span>
          <span className="label">Changes</span>
          <span className="grow" />
          <Tb icon="check" title="Commit" /><Tb icon="refresh" title="Refresh" />
        </div>
        <div style={{ padding: '2px 8px 6px' }}>
          <input className="filter" placeholder="Message (Ctrl+Enter to commit on “main”)" aria-label="Commit message" />
          <button type="button" className="commit" disabled={!files.length}><Ci name="check" style={{ color: 'inherit' }} /> Commit</button>
        </div>
        {files.length > 0 && (
          <>
            <div className="row" style={{ paddingLeft: 4, fontWeight: 600 }}>
              <span className="tw"><Ci name="chevron-down" /></span>
              <span className="label">Changes</span>
              <span className="grow" />
              <span className="pill">{files.length}</span>
            </div>
            {files.map(f => {
              const name = f.path.split('/').at(-1)!
              return (
                <div key={f.path} className="row" style={{ paddingLeft: 20 }} onClick={() => openFile(f.path, { diff: true })}>
                  <FileIcon name={name} />
                  <span className="label">{name}</span>
                  <span className="desc">{f.path.slice(0, f.path.length - name.length - 1).replace(/\//g, '\\')}</span>
                  <span className="grow" />
                  <span className="gm">M</span>
                </div>
              )
            })}
          </>
        )}
        <div style={{ flex: 1 }} />
        <Pane title="Graph" open={graph} onToggle={() => setGraph(g => !g)} actions={<><Tb icon="git-branch" title="Auto" /><Tb icon="refresh" title="Refresh" /></>}>
          <div className="row" style={{ paddingLeft: 8, height: 26 }}>
            <Ci name="circle-large-outline" style={{ color: '#6f86ff' }} />
            <span className="label" style={{ color: 'var(--vscode-foreground)' }}>Orders, billing and shipping services</span>
            <span className="desc">Demo</span>
            <span className="grow" />
            <span className="ref">main</span>
          </div>
        </Pane>
      </div>
    </>
  )
}

// ---- the simple ones ------------------------------------------------------------------------------------------------------

export function Search() {
  return (
    <>
      <div className="viewtitle"><span className="grow">Search</span><Tb icon="refresh" title="Refresh" /><Tb icon="clear-all" title="Clear Search Results" /></div>
      <div className="viewbody" style={{ padding: '0 8px' }}>
        <input className="filter" placeholder="Search" aria-label="Search" />
        <input className="filter" placeholder="Replace" aria-label="Replace" style={{ marginTop: 6 }} />
        <p className="pempty" style={{ padding: '14px 4px' }}>The demo project is small: use the Explorer, or Axle: Endpoints to find a flow.</p>
      </div>
    </>
  )
}

export function Debug() {
  return (
    <>
      <div className="viewtitle"><span className="grow">Run and Debug</span></div>
      <div className="viewbody" style={{ padding: '0 12px' }}>
        <button type="button" className="commit" style={{ marginTop: 6 }}>Run and Debug</button>
        <p className="pempty" style={{ padding: '10px 0' }}>To customize Run and Debug create a launch.json file.</p>
      </div>
    </>
  )
}

export function Extensions() {
  const items = [
    ['Axle View', 'See code as a flow: callers on the left, the method in the middle, everything it calls on the right.', 'Axle'],
    ['Axle Agents', 'Claude Code and Codex in terminals, with live status in the Agents dock.', 'Axle'],
    ['Axle Harness', 'The map of what shapes your agents: instructions, rules, skills, hooks, MCP servers.', 'Axle'],
    ['Axle Theme', 'Axle Dark and Axle Light.', 'Axle'],
  ]
  return (
    <>
      <div className="viewtitle"><span className="grow">Extensions</span><Tb icon="filter" title="Filter Extensions…" /></div>
      <div className="viewbody">
        <div style={{ padding: '0 8px 6px' }}><input className="filter" placeholder="Search Extensions in Marketplace" aria-label="Search extensions" /></div>
        <div className="row" style={{ paddingLeft: 4, fontWeight: 600, fontSize: 11 }}><span className="tw"><Ci name="chevron-down" /></span><span className="label">Installed</span><span className="grow" /><span className="pill">{items.length}</span></div>
        {items.map(([name, text, who]) => (
          <div key={name} className="ext">
            <span className="extico"><Ci name="extensions" /></span>
            <div><b>{name}</b><div className="desc" style={{ margin: 0 }}>{text}</div><div className="desc" style={{ margin: 0 }}>{who}</div></div>
          </div>
        ))}
      </div>
    </>
  )
}
