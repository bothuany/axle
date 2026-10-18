// The Axle window: title bar, the sidebar with its row of view icons, the editor groups with the terminal under them, the side
// panel with the Agents dock, and the status bar. Laid out at real size and to the numbers measured in the real app.
import { useEffect, useMemo, useState } from 'react'
import { attentionKind } from '../../../editor/extensions/flow-agent/src/attention'
import { allSessions, needsYou, subscribeSessions } from '../sim/sessions'
import { focusSession } from '../sim/scenario'
import { CodeGroup, FlowGroup } from './editor'
import { Harness } from './harness'
import { AxleMark, ClaudeIcon } from './icons'
import { Dock } from './pages'
import { Panel } from './panel'
import { Ci, Tb } from './parts'
import { changedFiles, demo, dismissToast, get, openFile, set, useWorkbench, type ViewId } from './store'
import { Debug, Endpoints, Explorer, Extensions, Search, SourceControl } from './views'

function useSessions() {
  const [, force] = useState(0)
  useEffect(() => subscribeSessions(() => force(n => n + 1)), [])
  return allSessions()
}

function TitleBar() {
  const tab = useWorkbench(s => s.codeTabs.find(t => t.id === s.activeCode))
  return (
    <div className="titlebar">
      <div className="lights" aria-hidden="true">
        <i />
        <i />
        <i />
      </div>
      <div className="navs">
        <Tb icon="arrow-left" title="Go Back" />
        <Tb icon="arrow-right" title="Go Forward" />
      </div>
      <div className="center-cmd" role="button" tabIndex={0} aria-label="Search files, commands and endpoints">
        <Ci name="search" className="s" />
        <span>harbor-goods{tab ? ` - ${tab.path.split('/').at(-1)}` : ''}</span>
      </div>
      <div className="right">
        <Tb icon="layout-sidebar-left" title="Toggle Primary Side Bar" onClick={() => set(s => ({ sidebar: !s.sidebar }))} />
        <Tb icon="account" title="Accounts" />
        <Tb icon="settings-gear" title="Manage" />
      </div>
    </div>
  )
}

const ACTIVITIES: { id: ViewId; icon?: string; src?: string; title: string }[] = [
  { id: 'explorer', icon: 'files', title: 'Explorer (Ctrl+Shift+E)' },
  { id: 'search', icon: 'search', title: 'Search (Ctrl+Shift+F)' },
  { id: 'scm', icon: 'source-control', title: 'Source Control (Ctrl+Shift+G)' },
  { id: 'debug', icon: 'debug-alt', title: 'Run and Debug (Ctrl+Shift+D)' },
  { id: 'extensions', icon: 'extensions', title: 'Extensions (Ctrl+Shift+X)' },
  { id: 'harness', src: './media/harness.svg', title: 'Harness' },
  { id: 'axle', src: './media/flow.svg', title: 'Axle' },
]

function Sidebar() {
  const view = useWorkbench(s => s.view)
  const edited = useWorkbench(s => s.edited)
  const count = changedFiles(edited).length
  return (
    <aside className="sidebar" aria-label="Primary side bar">
      <div className="actrow" role="tablist" aria-label="Views">
        <button type="button" className="act" aria-label="Application Menu" title="Application Menu">
          <Ci name="menu" />
        </button>
        {ACTIVITIES.map(a => (
          <button key={a.id} type="button" role="tab" aria-selected={view === a.id} className={`act${view === a.id ? ' on' : ''}`} title={a.title} aria-label={a.title} onClick={() => set({ view: a.id })}>
            {a.src ? <img src={a.src} alt="" /> : <Ci name={a.icon!} />}
            {a.id === 'scm' && count > 0 && <span className="badge">{count}</span>}
          </button>
        ))}
      </div>
      {view === 'explorer' && <Explorer />}
      {view === 'search' && <Search />}
      {view === 'scm' && <SourceControl />}
      {view === 'debug' && <Debug />}
      {view === 'extensions' && <Extensions />}
      {view === 'harness' && <Harness />}
      {view === 'axle' && <Endpoints />}
    </aside>
  )
}

function AuxBar() {
  const sessions = useSessions()
  const n = needsYou(sessions)
  return (
    <aside className="auxbar" aria-label="Secondary side bar">
      <div className="actrow">
        <button type="button" className="act" title="Chat" aria-label="Chat">
          <Ci name="comment-discussion" />
        </button>
        <button type="button" className="act on" title="Agents" aria-label="Agents" aria-selected="true">
          <Ci name="sparkle" style={{ color: 'var(--vscode-activityBar-foreground)' }} />
          {n > 0 && <span className="badge">{n}</span>}
        </button>
      </div>
      <div className="viewtitle">
        <span className="grow" />
        <Tb icon="history" title="Resume an earlier session" />
        <Tb icon="add" title="Start an agent" />
        <Tb icon="screen-full" title="Maximize" />
      </div>
      <Dock />
    </aside>
  )
}

function StatusBar() {
  const sessions = useSessions()
  const edited = useWorkbench(s => s.edited)
  const code = useWorkbench(s => s.codeTabs.find(t => t.id === s.activeCode))
  const first = sessions[0]
  const lang = code?.path.endsWith('.java') ? 'Java' : code?.path.endsWith('.py') ? 'Python' : code?.path.endsWith('.md') ? 'Markdown' : code?.path.endsWith('.json') ? 'JSON' : ''
  // Claude's plan limits, as its status line last reported them: the item appears once an agent has run.
  const used = first ? (first.state === 'done' ? 15 : 13) : undefined
  return (
    <div className="statusbar" role="status" aria-label="Status bar">
      <span className="sitem" title="Open a Remote Window"><Ci name="remote" /></span>
      <span className="sitem" title="Checkout Branch/Tag…"><Ci name="git-branch" />main{edited ? '*' : ''}</span>
      <span className="sitem" title="Synchronize Changes"><Ci name="sync" /></span>
      <span className="sitem" title="No Problems"><Ci name="error" />0 <Ci name="warning" />0</span>
      <span className="grow" />
      {used !== undefined && (
        <span className="sitem" title="Claude: plan usage. As Claude last reported it. Context per agent is in the Agents dock.">
          <Ci name="pulse" />Claude 5h {used}% · 7d 36%
        </span>
      )}
      {code && !code.diff && <span className="sitem">Ln {code.line ?? 1}, Col 1</span>}
      {code && <span className="sitem">Spaces: 4</span>}
      {code && <span className="sitem">UTF-8</span>}
      {code && <span className="sitem">LF</span>}
      {lang && <span className="sitem">{lang}</span>}
      <span className="sitem" title="Notifications"><Ci name="bell" /></span>
    </div>
  )
}

function Toast() {
  const toast = useWorkbench(s => s.toast)
  useEffect(() => {
    if (!toast) return
    const t = setTimeout(dismissToast, 9000)
    return () => clearTimeout(t)
  }, [toast])
  if (!toast) return null
  const show = () => {
    const waiting = allSessions().find(s => attentionKind(s))
    if (waiting) focusSession(waiting.id)
    dismissToast()
  }
  return (
    <div className="toast" role="status">
      {toast.text}
      {toast.actions && (
        <div className="acts">
          {toast.actions.map(a => (
            <button key={a} type="button" className="btn" onClick={show}>
              {a}
            </button>
          ))}
          <button type="button" className="btn alt" onClick={dismissToast}>
            Dismiss
          </button>
        </div>
      )}
    </div>
  )
}

export function Window() {
  const sidebar = useWorkbench(s => s.sidebar)
  const hasFlow = useWorkbench(s => s.flowTabs.length > 0)
  // The code the demo opens with: the controller whose flow the canvas shows.
  useMemo(() => {
    if (get().codeTabs.length === 0) openFile('orders-service/src/main/java/com/harborgoods/orders/OrderController.java')
    void demo()
  }, [])
  return (
    <div className="window">
      <TitleBar />
      <div className="workspace">
        {sidebar && <Sidebar />}
        <div className="center">
          <div className="groups">
            <CodeGroup />
            {hasFlow && <FlowGroup />}
          </div>
          <Panel />
        </div>
        <AuxBar />
      </div>
      <StatusBar />
      <Toast />
    </div>
  )
}

export { AxleMark, ClaudeIcon }
