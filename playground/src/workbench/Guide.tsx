// A short guide under the screen: what to try, in order, and where the demo is. Each step knows when it is done by looking at the
// workbench (an agent exists, its edit is in, a flow it touched is open, the Harness view was looked at); nothing is counted twice.
import { useEffect, useState } from 'react'
import { allSessions, subscribeSessions } from '../sim/sessions'
import { answerPermission, openTurnFlow, pendingPermission, setAutopilot, startClaude } from '../sim/scenario'
import { demo, set, useWorkbench } from './store'

export function Guide() {
  const [, force] = useState(0)
  useEffect(() => subscribeSessions(() => force(n => n + 1)), [])
  const sessions = allSessions()
  const edited = useWorkbench(s => s.edited)
  const view = useWorkbench(s => s.view)
  const flow = useWorkbench(s => s.flowTabs[0])
  const [sawHarness, setSawHarness] = useState(false)
  useEffect(() => {
    if (view === 'harness') setSawHarness(true)
  }, [view])
  const started = sessions.length > 0
  const asked = !!pendingPermission()
  const touched = demo().agentImpact.flows.some(f => flow?.target.kind === 'poly' && flow.target.id === f.id) || flow?.target.kind === 'changes'
  const session = sessions.at(-1)
  const finished = session?.state === 'done'
  const steps = [
    { done: started, title: 'Start Claude', body: 'Press Claude in the Agents dock, on the right. It opens in a terminal like it always does.', action: started ? undefined : { label: 'Start Claude', run: startClaude } },
    { done: edited, title: 'Let it edit', body: asked ? 'Claude asks before it edits. Answer in the terminal (press Enter), or with the button.' : 'Watch the dock row, the notch and the terminal: this is what “needs you” looks like.', action: asked ? { label: 'Allow the edit', run: () => answerPermission('yes') } : undefined },
    { done: touched && finished, title: 'Follow the change', body: 'The dock lists the flows the turn touched. Open one: the canvas marks what changed.', action: finished && session?.impact ? { label: 'Open POST /orders', run: () => openTurnFlow(session.id, session.impact!.flows.findIndex(f => f.label === 'POST /orders')) } : undefined },
    { done: sawHarness, title: 'Look at the harness', body: 'Instructions, rules, skills, hooks and MCP servers that shape the agent, with what each costs.', action: { label: 'Open the Harness view', run: () => set({ view: 'harness', sidebar: true }) } },
  ]
  const current = steps.findIndex(s => !s.done)
  return (
    <section className="guide" aria-label="What to try">
      <ol>
        {steps.map((s, i) => (
          <li key={s.title} className={s.done ? 'done' : i === current ? 'now' : ''}>
            <span className="mark" aria-hidden="true">{s.done ? '✓' : i + 1}</span>
            <div>
              <h3>{s.title}</h3>
              <p>{s.body}</p>
              {s.action && i === current && (
                <button type="button" onClick={s.action.run}>
                  {s.action.label}
                </button>
              )}
            </div>
          </li>
        ))}
      </ol>
      <div className="side">
        <button
          type="button"
          className="play"
          disabled={started}
          onClick={() => {
            setAutopilot(true)
            startClaude()
          }}
        >
          Play it for me
        </button>
        <p>The agent in this demo is a scripted replay. The dock, the notch, the terminal layout, the canvas and the harness map are Axle’s own.</p>
      </div>
    </section>
  )
}
