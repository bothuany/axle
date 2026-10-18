// The Harness view: the map of what shapes the agents (instructions, rules, skills, subagents, hooks, MCP servers, permissions), the
// permission requests, and the friction inbox. The rows are flow-harness's scan of the demo project, grouped and worded the way its
// tree (flow-harness/src/tree.ts) does it.
import { useMemo, useState } from 'react'
import type { HarnessItem } from '../demo'
import { Ci, Pane, Tb } from './parts'
import { demo, openFile, toast } from './store'

type Kind = HarnessItem['kind']
const GROUPS: { kind: Kind; label: string; icon: string; color: string; empty: string }[] = [
  { kind: 'instructions', label: 'Instructions', icon: 'book', color: 'instructions', empty: 'No CLAUDE.md or AGENTS.md yet' },
  { kind: 'rules', label: 'Rules', icon: 'law', color: 'rules', empty: 'No path-scoped rules' },
  { kind: 'skills', label: 'Skills', icon: 'sparkle', color: 'skills', empty: 'No skills in this repo or your home folder' },
  { kind: 'agents', label: 'Subagents', icon: 'organization', color: 'agents', empty: 'No subagents' },
  { kind: 'hooks', label: 'Hooks', icon: 'zap', color: 'hooks', empty: 'No hooks' },
  { kind: 'mcp', label: 'MCP servers', icon: 'plug', color: 'mcp', empty: 'No MCP servers in settings or .mcp.json' },
  { kind: 'permissions', label: 'Permission rules', icon: 'shield', color: 'permissions', empty: 'No allow or deny rules' },
  { kind: 'memory', label: 'Memory', icon: 'history', color: 'instructions', empty: 'No agent memory for this folder' },
]
const SCOPE_LABEL = { user: 'you', project: 'repo', local: 'local', directory: 'folder' } as const
const tok = (n?: number) => (n === undefined ? '' : n >= 1000 ? `${(n / 1000).toFixed(1)}k tok` : `${n} tok`)
const k = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n))
const worst = (i: HarnessItem) => (i.issues.some(x => x.severity === 'error') ? 'error' : i.issues.some(x => x.severity === 'warning') ? 'warning' : i.issues.length ? 'info' : undefined)
const color = (name: string) => `var(--vscode-flowHarness-${name}, var(--vscode-icon-foreground))`

function Item({ item, open, toggle }: { item: HarnessItem; open: boolean; toggle: () => void }) {
  const sev = worst(item)
  const description = [SCOPE_LABEL[item.scope], item.mcp?.state === 'pending' ? 'awaiting approval' : item.mcp?.state === 'off' ? 'off' : '', item.kind === 'hooks' || item.kind === 'permissions' ? item.detail : tok(item.tokens)].filter(Boolean).join('  ')
  const icon = sev ? (sev === 'error' ? 'error' : sev === 'warning' ? 'warning' : 'info') : item.rule ? (item.rule.effect === 'deny' ? 'circle-slash' : item.rule.effect === 'ask' ? 'question' : 'pass') : 'circle-small-filled'
  const iconColor = sev ? (sev === 'error' ? 'var(--vscode-errorForeground)' : sev === 'warning' ? 'var(--vscode-editorWarning-foreground)' : 'var(--vscode-descriptionForeground)') : item.rule ? color(item.rule.effect) : color(GROUPS.find(g => g.kind === item.kind)!.color)
  const open_ = () => {
    const path = item.file.replace(/^\/demo\//, '')
    if (item.mcp) toast('In the Axle app an MCP server opens in the manager: its status, its tools, and edits that keep secrets out of view.')
    else if (demo().files.some(f => f.path === path)) openFile(path)
  }
  return (
    <>
      <div className="row" style={{ paddingLeft: 20 }} onClick={() => { if (item.issues.length) toggle(); open_() }} title={`${item.label}\n${item.detail}\n${item.agents.join(', ')} · ${item.scope} scope${item.tokens ? ` · about ${item.tokens.toLocaleString()} tokens per session` : ''}`}>
        <span className="tw">{item.issues.length > 0 && <Ci name={open ? 'chevron-down' : 'chevron-right'} />}</span>
        <Ci name={icon} style={{ color: iconColor }} />
        <span className="label" style={{ color: 'var(--vscode-foreground)' }}>{item.label}</span>
        <span className="desc">{description}</span>
      </div>
      {open &&
        item.issues.map((issue, i) => (
          <div key={i} className="row" style={{ paddingLeft: 40 }} onClick={() => open_()} title={issue.fix ? `${issue.message}\n\nFix: ${issue.fix}` : issue.message}>
            <Ci name={issue.severity === 'error' ? 'error' : issue.severity === 'warning' ? 'warning' : 'info'} style={{ color: issue.severity === 'error' ? 'var(--vscode-errorForeground)' : issue.severity === 'warning' ? 'var(--vscode-editorWarning-foreground)' : 'var(--vscode-descriptionForeground)' }} />
            <span className="label">{issue.message}</span>
          </div>
        ))}
    </>
  )
}

export function Harness() {
  const h = demo().harness
  const claude = (i: HarnessItem) => i.agents.includes('Claude')
  const onDemand = h.items.filter(claude).reduce((a, i) => a + (i.onDemand ?? 0), 0)
  const problems = h.counts.error + h.counts.warning
  const missing = h.gaps.filter(g => g.key !== 'unused')
  const tokens = `About ${(h.startupTokens / 1000).toFixed(1)}k tokens load before your first prompt${onDemand ? `, and about ${k(onDemand)} more on demand` : ''}.`
  const message = problems ? `${h.counts.error ? `${h.counts.error} broken, ` : ''}${h.counts.warning} to look at.${missing.length ? ` Not set up here: ${missing.map(g => g.label).join(', ')}.` : ''} ${tokens}` : `Nothing broken.${missing.length ? ` Not set up here: ${missing.map(g => g.label).join(', ')}.` : ''} ${tokens}`
  const [map, setMap] = useState(true)
  const [perm, setPerm] = useState(true)
  const [friction, setFriction] = useState(true)
  // A group with something to fix starts open; the rest start folded, as in the real tree.
  const [open, setOpen] = useState<Set<string>>(() => new Set(GROUPS.filter(g => h.items.some(i => i.kind === g.kind && i.issues.some(x => x.severity !== 'info'))).map(g => g.kind)))
  const [openItems, setOpenItems] = useState<Set<string>>(() => new Set(h.items.filter(i => i.issues.length).map(i => `${i.kind}:${i.label}`)))
  const toggle = (set: (f: (s: Set<string>) => Set<string>) => void, key: string) => set(s => { const n = new Set(s); if (n.has(key)) n.delete(key); else n.add(key); return n })
  const order = { user: 0, project: 1, local: 2, directory: 3 }
  const rank = (i: HarnessItem) => ({ error: 0, warning: 1, info: 2, none: 3 })[worst(i) ?? 'none']
  const items = useMemo(() => (kind: Kind) => h.items.filter(i => i.kind === kind).sort((a, b) => rank(a) - rank(b) || order[a.scope] - order[b.scope] || a.label.localeCompare(b.label, 'en')), [h])
  return (
    <>
      <div className="viewtitle">
        <span className="grow">Harness</span>
        <Tb icon="ellipsis" title="Views and More Actions…" />
      </div>
      <div className="viewbody">
        <Pane
          title="Map"
          open={map}
          onToggle={() => setMap(m => !m)}
          actions={
            <>
              <span className="desc" style={{ fontWeight: 400, margin: '0 6px' }}>Health {h.score} · {k(h.startupTokens)} always-on{onDemand ? ` · ${k(onDemand)} on demand` : ''}</span>
              <Tb icon="pulse" title="What actually runs" />
              <Tb icon="question" title="Why does this apply?" />
              <Tb icon="refresh" title="Scan Again" />
            </>
          }
        >
          <p className="msg">{message}</p>
          {GROUPS.map(g => {
            const list = items(g.kind)
            const t = list.reduce((a, i) => a + (i.agents.includes('Claude') ? i.tokens ?? 0 : 0), 0)
            const od = list.reduce((a, i) => a + (i.agents.includes('Claude') ? i.onDemand ?? 0 : 0), 0)
            const fix = list.reduce((a, i) => a + i.issues.filter(x => x.severity !== 'info').length, 0)
            const desc = list.length ? [String(list.length), t ? tok(t) : '', od ? `+${k(od)} on demand` : '', fix ? `${fix} to fix` : ''].filter(Boolean).join('  ') : g.empty
            const isOpen = list.length > 0 && open.has(g.kind)
            return (
              <div key={g.kind}>
                <div className="row" style={{ paddingLeft: 4 }} onClick={() => list.length && toggle(setOpen, g.kind)}>
                  <span className="tw">{list.length > 0 && <Ci name={isOpen ? 'chevron-down' : 'chevron-right'} />}</span>
                  <Ci name={g.icon} style={{ color: color(g.color) }} />
                  <span className="label" style={{ color: 'var(--vscode-foreground)' }}>{g.label}</span>
                  <span className="desc">{desc}</span>
                </div>
                {isOpen && list.map(i => <Item key={`${i.kind}:${i.label}`} item={i} open={openItems.has(`${i.kind}:${i.label}`)} toggle={() => toggle(setOpenItems, `${i.kind}:${i.label}`)} />)}
              </div>
            )
          })}
        </Pane>
        <Pane title="Permission requests" open={perm} onToggle={() => setPerm(p => !p)}>
          <div className="row" style={{ paddingLeft: 20, cursor: 'default' }}>
            <span className="label" style={{ color: 'var(--vscode-foreground)' }}>Permission requests from agents show up here</span>
          </div>
        </Pane>
        <Pane title="Friction inbox" open={friction} onToggle={() => setFriction(f => !f)}>
          {[
            ['comment-discussion', 'Corrections you repeat', 'Nothing said twice yet'],
            ['error', 'Tool calls that keep failing', 'No repeated failures'],
            ['shield', 'Permissions you keep granting', 'No permission granted twice'],
          ].map(([icon, label, empty]) => (
            <div key={label} className="row" style={{ paddingLeft: 4 }} title={empty}>
              <span className="tw" />
              <Ci name={icon} />
              <span className="label" style={{ color: 'var(--vscode-foreground)' }}>{label}</span>
            </div>
          ))}
        </Pane>
      </div>
    </>
  )
}
