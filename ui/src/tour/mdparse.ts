// Captions and notes are Markdown, never HTML: this parses the small subset an agent's explanation needs (paragraphs, lists,
// headings, fenced code, quotes, `code`, **bold**, *italic*, links) into a plain tree that React renders as elements. Nothing
// here builds markup strings, so a tag in the text is only ever text, and a link keeps only an http(s) or mailto address.
// Pure and free of imports, so it runs under plain Node (ui/test).

export type Inline =
  | { t: 'text'; text: string }
  | { t: 'code'; text: string }
  | { t: 'b'; kids: Inline[] }
  | { t: 'i'; kids: Inline[] }
  | { t: 'a'; href: string; kids: Inline[] }

export type Block =
  | { t: 'p'; kids: Inline[] }
  | { t: 'h'; kids: Inline[] }
  | { t: 'ul' | 'ol'; items: Inline[][] }
  | { t: 'pre'; code: string; lang: string }
  | { t: 'quote'; kids: Inline[] }

/** The only addresses a link may have: anything else (javascript:, data:, a command: URI of the editor) renders as its text. */
export const safeHref = (href: string): string | null => (/^(https?:\/\/|mailto:)[^\s<>"'`]+$/i.test(href.trim()) ? href.trim() : null)

const MAX_DEPTH = 3

export function parseInline(src: string, depth = 0): Inline[] {
  const out: Inline[] = []
  let buf = ''
  const flush = () => {
    if (buf) out.push({ t: 'text', text: buf })
    buf = ''
  }
  let i = 0
  while (i < src.length) {
    const c = src[i]
    if (c === '\\' && i + 1 < src.length && /[\\`*_[\]()#>-]/.test(src[i + 1])) {
      buf += src[i + 1]
      i += 2
      continue
    }
    if (c === '`') {
      const end = src.indexOf('`', i + 1)
      if (end > i + 1) {
        flush()
        out.push({ t: 'code', text: src.slice(i + 1, end) })
        i = end + 1
        continue
      }
    }
    if (depth < MAX_DEPTH && (src.startsWith('**', i) || src.startsWith('__', i))) {
      const mark = src.slice(i, i + 2)
      const end = src.indexOf(mark, i + 2)
      if (end > i + 2) {
        flush()
        out.push({ t: 'b', kids: parseInline(src.slice(i + 2, end), depth + 1) })
        i = end + 2
        continue
      }
    }
    if (depth < MAX_DEPTH && (c === '*' || c === '_') && src[i + 1] !== ' ' && src[i + 1] !== c) {
      // An underscore inside a word (snake_case) is not emphasis.
      const word = c === '_' && i > 0 && /\w/.test(src[i - 1])
      const end = word ? -1 : src.indexOf(c, i + 1)
      if (end > i + 1 && src[end - 1] !== ' ' && !(c === '_' && /\w/.test(src[end + 1] ?? ''))) {
        flush()
        out.push({ t: 'i', kids: parseInline(src.slice(i + 1, end), depth + 1) })
        i = end + 1
        continue
      }
    }
    if (c === '[' && depth < MAX_DEPTH) {
      const m = /^\[([^\]\n]+)\]\(([^()\s]+)\)/.exec(src.slice(i))
      if (m) {
        flush()
        const href = safeHref(m[2])
        const kids = parseInline(m[1], depth + 1)
        if (href) out.push({ t: 'a', href, kids })
        else out.push(...kids)
        i += m[0].length
        continue
      }
    }
    // A bare address is a link too.
    if ((c === 'h' || c === 'H') && /^https?:\/\//i.test(src.slice(i, i + 8))) {
      const m = /^https?:\/\/[^\s<>"'`)\]]+[^\s<>"'`)\].,;:!?]/i.exec(src.slice(i))
      if (m && safeHref(m[0])) {
        flush()
        out.push({ t: 'a', href: m[0], kids: [{ t: 'text', text: m[0] }] })
        i += m[0].length
        continue
      }
    }
    buf += c
    i++
  }
  flush()
  return out
}

const BULLET = /^\s{0,3}[-*+]\s+(.*)$/
const ORDERED = /^\s{0,3}\d{1,3}[.)]\s+(.*)$/
const FENCE = /^\s{0,3}(`{3,}|~{3,})\s*([\w+#.-]*)\s*$/

export function parseMarkdown(src: string): Block[] {
  const lines = src.replace(/\r\n?/g, '\n').split('\n')
  const blocks: Block[] = []
  let para: string[] = []
  const endPara = () => {
    if (para.length) blocks.push({ t: 'p', kids: parseInline(para.join(' ')) })
    para = []
  }
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const fence = FENCE.exec(line)
    if (fence) {
      endPara()
      const code: string[] = []
      // An unclosed fence runs to the end: a reply cut off halfway still shows as code.
      for (i++; i < lines.length && !new RegExp(`^\\s{0,3}${fence[1][0]}{${fence[1].length},}\\s*$`).test(lines[i]); i++) code.push(lines[i])
      blocks.push({ t: 'pre', code: code.join('\n'), lang: fence[2] })
      continue
    }
    if (!line.trim()) {
      endPara()
      continue
    }
    const head = /^\s{0,3}#{1,6}\s+(.*?)\s*#*\s*$/.exec(line)
    if (head) {
      endPara()
      blocks.push({ t: 'h', kids: parseInline(head[1]) })
      continue
    }
    const kind = BULLET.test(line) ? 'ul' : ORDERED.test(line) ? 'ol' : null
    if (kind) {
      endPara()
      const re = kind === 'ul' ? BULLET : ORDERED
      const items: string[] = []
      for (; i < lines.length; i++) {
        const m = re.exec(lines[i])
        if (m) items.push(m[1])
        // A line indented under an item continues it.
        else if (items.length && /^\s{2,}\S/.test(lines[i]) && !BULLET.test(lines[i]) && !ORDERED.test(lines[i])) items[items.length - 1] += ` ${lines[i].trim()}`
        else break
      }
      i--
      blocks.push({ t: kind, items: items.map(t => parseInline(t)) })
      continue
    }
    if (/^\s{0,3}>\s?/.test(line)) {
      endPara()
      const q: string[] = []
      for (; i < lines.length && /^\s{0,3}>\s?/.test(lines[i]); i++) q.push(lines[i].replace(/^\s{0,3}>\s?/, ''))
      i--
      blocks.push({ t: 'quote', kids: parseInline(q.join(' ')) })
      continue
    }
    para.push(line.trim())
  }
  endPara()
  return blocks
}
