// Renders the parsed Markdown (mdparse.ts) as React elements: there is no dangerouslySetInnerHTML, so text from an agent can
// only ever be text, and a link is an http(s) or mailto anchor that opens outside the canvas.
import type { ReactNode } from 'react'
import { parseMarkdown, type Inline } from './mdparse'

function inline(kids: Inline[]): ReactNode[] {
  return kids.map((k, i) => {
    switch (k.t) {
      case 'text': return k.text
      case 'code': return <code key={i}>{k.text}</code>
      case 'b': return <strong key={i}>{inline(k.kids)}</strong>
      case 'i': return <em key={i}>{inline(k.kids)}</em>
      case 'a': return <a key={i} href={k.href} target="_blank" rel="noreferrer noopener">{inline(k.kids)}</a>
    }
  })
}

export function Markdown({ text, className }: { text: string; className?: string }) {
  return (
    <div className={`md${className ? ` ${className}` : ''}`}>
      {parseMarkdown(text).map((b, i) => {
        switch (b.t) {
          case 'p': return <p key={i}>{inline(b.kids)}</p>
          case 'h': return <p key={i} className="md-h">{inline(b.kids)}</p>
          case 'quote': return <blockquote key={i}>{inline(b.kids)}</blockquote>
          case 'ul': return <ul key={i}>{b.items.map((it, j) => <li key={j}>{inline(it)}</li>)}</ul>
          case 'ol': return <ol key={i}>{b.items.map((it, j) => <li key={j}>{inline(it)}</li>)}</ol>
          case 'pre': return <pre key={i} data-lang={b.lang || undefined}><code>{b.code}</code></pre>
        }
      })}
    </div>
  )
}
