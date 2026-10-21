// The Markdown of captions and notes (src/tour/mdparse.ts), the step counter and the bar's layout rules. Pure, plain Node.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { parseInline, parseMarkdown, safeHref } from '../src/tour/mdparse.ts'
import { counterText } from '../src/tour/player.ts'

const flat = kids => kids.map(k => (k.kids ? `<${k.t}>${flat(k.kids)}</${k.t}>` : k.t === 'code' ? `\`${k.text}\`` : k.text)).join('')

test('paragraphs, lists, headings, quotes and fenced code', () => {
  const blocks = parseMarkdown('# Title\n\nFirst line\nsecond line\n\n- one\n- two\n  more\n\n1. a\n2. b\n\n> said\n\n```java\nint x = 1;\n\nint y;\n```\nafter')
  assert.deepEqual(blocks.map(b => b.t), ['h', 'p', 'ul', 'ol', 'quote', 'pre', 'p'])
  assert.equal(flat(blocks[1].kids), 'First line second line')
  assert.equal(blocks[2].items.length, 2)
  assert.equal(flat(blocks[2].items[1]), 'two more')
  assert.deepEqual(blocks[5], { t: 'pre', code: 'int x = 1;\n\nint y;', lang: 'java' })
})

test('an unclosed fence runs to the end instead of swallowing nothing', () => {
  const [b] = parseMarkdown('```\nhalf of a reply')
  assert.deepEqual(b, { t: 'pre', code: 'half of a reply', lang: '' })
})

test('inline code, bold, italic and links', () => {
  assert.equal(flat(parseInline('a `x_y` **b** *c* [d](https://e.dev/p)')), 'a `x_y` <b>b</b> <i>c</i> <a>d</a>')
  assert.equal(flat(parseInline('snake_case_name stays')), 'snake_case_name stays')
  assert.equal(flat(parseInline('2 * 3 * 4')), '2 * 3 * 4')
  const link = parseInline('see https://example.com/a.')[1]
  assert.equal(link.href, 'https://example.com/a', 'a bare address leaves its closing dot out')
})

test('markup is never made: tags stay text and only safe addresses become links', () => {
  const raw = '<img src=x onerror=alert(1)> <script>x</script>'
  assert.equal(flat(parseInline(raw)), raw, 'HTML is plain text, React escapes it')
  for (const bad of ['javascript:alert(1)', 'data:text/html,x', 'command:workbench.action.x', 'vbscript:x', '//evil.test', 'file:///c:/x']) {
    assert.equal(safeHref(bad), null, bad)
    const [only] = parseInline(`[click](${bad})`)
    assert.equal(only.t, 'text', `${bad} keeps only its text`)
  }
  assert.equal(safeHref('https://a.dev/x?y=1'), 'https://a.dev/x?y=1')
  assert.equal(safeHref('mailto:a@b.dev'), 'mailto:a@b.dev')
  assert.equal(safeHref('https://a.dev/"onmouseover="x'), null)
})

test('deeply nested or huge input terminates', () => {
  const t = Date.now()
  parseMarkdown('*'.repeat(5000) + '\n' + '['.repeat(5000) + '\n' + '`'.repeat(5000))
  parseMarkdown(('- x\n').repeat(3000))
  assert.ok(Date.now() - t < 2000)
})

test('the step counter is one unbreakable word and the bar keeps it on one line', () => {
  assert.equal(counterText(1, 8), '2\u00a0/\u00a08')
  assert.ok(!/ /.test(counterText(11, 120)), 'no breaking space in it')
  const css = readFileSync(new URL('../src/webview.css', import.meta.url), 'utf8')
  const rule = css.split('\n').find(l => l.startsWith('.tour-pos {'))
  assert.match(rule, /white-space: nowrap/)
  assert.match(rule, /flex: none/)
})
