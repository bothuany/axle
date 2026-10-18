// The bottom panel: Problems, Output, Debug Console and the terminals. Each terminal is an xterm bound to a controller from sim/.
import { useEffect, useRef } from 'react'
import { Ci, Tb } from './parts'
import { get, set, useWorkbench, type PanelTab } from './store'
import { ClaudeIcon } from './icons'
import { updateSession } from '../sim/sessions'
import { mountTerminal, terminalController } from '../sim/term'

function XTerm({ id }: { id: string }) {
  const host = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const c = terminalController(id)
    if (!c || !host.current) return
    return mountTerminal(host.current, c)
  }, [id])
  return <div className="xt" ref={host} />
}

const TABS: [PanelTab, string][] = [['problems', 'Problems'], ['output', 'Output'], ['debug', 'Debug Console'], ['terminal', 'Terminal']]

export function Panel() {
  const open = useWorkbench(s => s.panel)
  const tab = useWorkbench(s => s.panelTab)
  const terminals = useWorkbench(s => s.terminals)
  const active = useWorkbench(s => s.activeTerminal)
  if (!open) return null
  return (
    <div className="panel" role="region" aria-label="Panel">
      <div className="ptabs" role="tablist">
        {TABS.map(([id, label]) => (
          <button key={id} type="button" role="tab" aria-selected={tab === id} className={`ptab${tab === id ? ' on' : ''}`} onClick={() => set({ panelTab: id })}>
            {label}
          </button>
        ))}
        <span className="grow" />
        {tab === 'terminal' && (
          <>
            <span className="sitem" style={{ color: 'var(--vscode-foreground)' }}>
              <Ci name="terminal" /> {terminals.find(t => t.id === active)?.kind === 'claude' ? 'claude' : 'zsh'}
            </span>
            <Tb icon="add" title="New Terminal" onClick={() => set(s => ({ terminals: s.terminals, panelTab: 'terminal' }))} />
            <Tb icon="split-horizontal" title="Split Terminal" />
            <Tb icon="trash" title="Kill Terminal" />
          </>
        )}
        <Tb icon="chevron-up" title="Maximize Panel Size" />
        <Tb icon="close" title="Hide Panel" onClick={() => set({ panel: false })} />
      </div>
      <div className="pbody">
        {tab === 'terminal' ? (
          <>
            <div className="termhost" onMouseDown={() => updateSession(active, { unread: false })}>
              <XTerm key={active} id={active} />
            </div>
            {terminals.length > 1 && (
              <div className="termlist" role="listbox" aria-label="Terminals">
                {terminals.map(t => (
                  <div key={t.id} role="option" aria-selected={t.id === active} className={`termrow${t.id === active ? ' on' : ''}`} onClick={() => set({ activeTerminal: t.id })}>
                    {t.kind === 'claude' ? <ClaudeIcon /> : <Ci name="terminal" />}
                    <span>{t.title}</span>
                  </div>
                ))}
              </div>
            )}
          </>
        ) : tab === 'problems' ? (
          <div className="pempty">No problems have been detected in the workspace.</div>
        ) : tab === 'output' ? (
          <div className="pempty">Nothing has been logged to this channel yet.</div>
        ) : (
          <div className="pempty">The debug console is not available: there is no debug session.</div>
        )}
      </div>
    </div>
  )
}

/** Shows the panel on its terminal tab (a click on a dock row, the overlay or a notification does this). */
export const showTerminal = (id?: string) => set({ panel: true, panelTab: 'terminal', activeTerminal: id ?? get().activeTerminal })
