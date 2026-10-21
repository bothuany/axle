// What shapes an agent in this project: the instructions, rules, skills, subagents, hooks and MCP servers flow-harness found, and the
// one thing it flags. The rows are flow-harness's own scan of the demo project (scripts/playground-data.mjs), grouped as its map groups them.
import { demo } from './store'
import type { HarnessItem } from './demo'

type Kind = HarnessItem['kind']
const GROUPS: { kind: Kind; label: string; what: string }[] = [
  { kind: 'instructions', label: 'Instructions', what: 'Read at the start of every session' },
  { kind: 'rules', label: 'Rules', what: 'Load only when the files they name are touched' },
  { kind: 'skills', label: 'Skills', what: 'Known by name, loaded when needed' },
  { kind: 'agents', label: 'Subagents', what: 'Helpers with their own instructions' },
  { kind: 'hooks', label: 'Hooks', what: 'Commands that run around tool calls' },
  { kind: 'mcp', label: 'MCP servers', what: 'Tools the agent can call' },
]
const k = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n))
const worst = (i: HarnessItem) => (i.issues.some(x => x.severity === 'error') ? 'error' : i.issues.some(x => x.severity === 'warning') ? 'warning' : undefined)

export function Harness() {
  const h = demo().harness
  const flagged = h.items.filter(i => worst(i))
  return (
    <div className="harness">
      <div className="groups">
        {GROUPS.map(g => {
          const items = h.items.filter(i => i.kind === g.kind)
          const tokens = items.reduce((a, i) => a + (i.agents.includes('Claude') ? i.tokens ?? 0 : 0), 0)
          return (
            <section key={g.kind} className={`group ${g.kind}`}>
              <h3>
                <span className="dot" aria-hidden="true" />
                {g.label}
                <span className="n">{items.length}</span>
              </h3>
              <p className="what">{g.what}</p>
              <ul>
                {items.map(i => (
                  <li key={`${i.kind}:${i.label}`} className={worst(i)} title={i.issues.map(x => x.message).join('\n') || i.detail}>
                    {i.label}
                  </li>
                ))}
              </ul>
              {tokens > 0 && <p className="tokens">about {k(tokens)} tokens</p>}
            </section>
          )
        })}
      </div>
      <aside className="flag" aria-label="What the scan flags">
        <p className="score">
          <b>{h.score}</b>
          <span>health, from the scan of this project</span>
        </p>
        {flagged.map(i => (
          <div key={`${i.kind}:${i.label}`} className="issue">
            <p>
              <b>{i.label}</b>
            </p>
            {i.issues.map((x, n) => (
              <p key={n} className="msg">
                {x.message}
                {x.fix ? <em> {x.fix}</em> : null}
              </p>
            ))}
          </div>
        ))}
        <p className="load">About {k(h.startupTokens)} tokens load before the first prompt.</p>
      </aside>
    </div>
  )
}
