// The documentation pages of the site, made from the repository's own Markdown (README.md and docs/), so the site and GitHub say
// the same thing: `node scripts/docs-pages.mjs` writes docs/<page>/index.html, which the build then treats like the other pages
// (vite.config.ts picks up every docs page). Generated, not committed. Links between these documents stay on the site; links to
// any other file of the repository go to it on GitHub.
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join, posix } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Marked } from 'marked'

const SITE = fileURLToPath(new URL('..', import.meta.url))
const ROOT = join(SITE, '..')
const OUT = join(SITE, 'docs')
const BLOB = 'https://github.com/{{repo}}/blob/main/'

/** The pages, in the order the sidebar lists them. `slug` '' is the overview, at docs/. `from`: where the page's text starts. */
export const DOCS = [
	{ slug: '', file: 'README.md', title: 'Overview', from: /^## /m, seo: '{{name}} docs: a code editor built on VS Code' },
	{ slug: 'install', file: 'docs/building.md', title: 'Install and build', seo: 'Install and build {{name}} on Windows, macOS, Linux' },
	{ slug: 'languages', file: 'docs/languages.md', title: 'Languages', seo: 'Languages and frameworks: call flows in {{name}}' },
	{ slug: 'agent-tools', file: 'docs/agent-tools.md', title: 'Agent tools', seo: 'Agent tools: the {{name}} MCP server for Claude Code, Codex' },
	{ slug: 'boards', file: 'docs/boards.md', title: 'Boards', seo: 'Boards: diagrams of your code in {{name}}' },
	{ slug: 'privacy', file: 'docs/privacy.md', title: 'Privacy', seo: 'Privacy: what {{name}} and insilode.dev collect' },
]

const escape = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
/** GitHub's heading anchors: lower case, punctuation dropped, spaces as hyphens. */
const anchor = text => text.toLowerCase().replace(/<[^>]+>/g, '').replace(/[^\p{L}\p{N}\s-]/gu, '').trim().replace(/\s/g, '-')

/** Where a link in `file` should go, seen from the page at `slug`. */
function target(href, file, slug) {
	if (/^(https?:|mailto:|#)/.test(href)) return href
	const [path, hash] = href.split('#')
	const resolved = posix.normalize(posix.join(posix.dirname(file), path))
	const page = DOCS.find(d => d.file === resolved)
	if (page) {
		const here = slug ? `docs/${slug}/` : 'docs/'
		const there = page.slug ? `docs/${page.slug}/` : 'docs/'
		const rel = posix.relative(here, there)
		return `${rel ? `${rel}/` : './'}${hash ? `#${hash}` : ''}`
	}
	return `${BLOB}${resolved}${hash ? `#${hash}` : ''}`
}

function render(doc) {
	let md = readFileSync(join(ROOT, doc.file), 'utf8').replace(/\r\n/g, '\n')
	if (doc.from) md = md.slice(md.search(doc.from))
	// The page's own title is the sidebar's: the document's first heading would repeat it.
	md = md.replace(/^# .*\n/, '')
	const toc = []
	const marked = new Marked({
		gfm: true,
		renderer: {
			heading({ tokens, depth }) {
				const html = this.parser.parseInline(tokens)
				const id = anchor(html)
				if (depth === 2) toc.push({ id, html })
				// One level down: the page's title is the only h1.
				const level = Math.min(depth + (depth === 1 ? 1 : 0), 6)
				return `<h${level} id="${id}">${html}</h${level}>\n`
			},
			link({ href, title, tokens }) {
				const text = this.parser.parseInline(tokens)
				return `<a href="${escape(target(href, doc.file, doc.slug))}"${title ? ` title="${escape(title)}"` : ''}>${text}</a>`
			},
			// The README's video and badges are GitHub's; the pages keep to text.
			image({ text }) {
				return escape(text)
			},
		},
	})
	const body = marked.parse(md)
	const text = body.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
	const description = text.length > 155 ? `${text.slice(0, text.lastIndexOf(' ', 152))}…` : text
	return { body, toc, description }
}

function page(doc, { body, toc, description }) {
	const depth = doc.slug ? '../../' : '../'
	const nav = DOCS.map(d => `<li><a href="${depth}docs/${d.slug ? `${d.slug}/` : ''}"${d === doc ? ' aria-current="page"' : ''}>${escape(d.title)}</a></li>`).join('\n            ')
	const onPage = toc.length > 1 ? `<nav class="doc-toc" aria-label="On this page"><p>On this page</p><ul>${toc.map(t => `<li><a href="#${t.id}">${t.html}</a></li>`).join('')}</ul></nav>` : ''
	return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self' https://api.github.com; base-uri 'none'; form-action 'none'" />
    <title>${escape(doc.seo)}</title>
    <meta name="description" content="${escape(description)}" />
    <link rel="canonical" href="{{site}}/docs/${doc.slug ? `${doc.slug}/` : ''}" />
    <link rel="icon" href="${depth}icon.svg" type="image/svg+xml" />
    <meta name="theme-color" content="#0c1020" />
    <meta property="og:type" content="article" />
    <meta property="og:site_name" content="{{name}}" />
    <meta name="robots" content="index, follow, max-image-preview:large" />
    <meta property="og:locale" content="en_US" />
    <meta property="og:title" content="${escape(doc.seo)}" />
    <meta property="og:description" content="${escape(description)}" />
    <meta property="og:url" content="{{site}}/docs/${doc.slug ? `${doc.slug}/` : ''}" />
    <meta property="og:image" content="{{site}}/media/og.jpg" />
    <meta property="og:image:width" content="1200" />
    <meta property="og:image:height" content="630" />
    <meta name="twitter:card" content="summary_large_image" />
    <meta name="twitter:title" content="${escape(doc.seo)}" />
    <meta name="twitter:description" content="${escape(description)}" />
    <meta name="twitter:image" content="{{site}}/media/og.jpg" />
  </head>
  <body>
    <a class="skip" href="#main">Skip to the content</a>
    <header class="nav">
      <a class="brand" href="${depth}"><img src="${depth}icon.svg" alt="" width="30" height="30" />{{name}}</a>
      <nav aria-label="Site">
        <ul class="nav-links">
          <li><a href="${depth}try/">Try it</a></li>
          <li class="wide"><a href="${depth}docs/" aria-current="page">Docs</a></li>
          <li class="wide"><a href="https://github.com/{{repo}}/releases">Changelog</a></li>
        </ul>
      </nav>
      <a class="star" href="https://github.com/{{repo}}" aria-label="{{name}} on GitHub">
        <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 .8l2.2 4.6 5 .7-3.6 3.5.9 5L8 12.2 3.5 14.6l.9-5L.8 6.1l5-.7z" /></svg>
        GitHub <span data-stars hidden></span>
      </a>
    </header>

    <div class="page docs">
      <div class="trace" aria-hidden="true"></div>
      <nav class="doc-nav" aria-label="Documentation">
        <ul>
            ${nav}
        </ul>
      </nav>
      <main id="main" class="doc">
        <h1>${escape(doc.title)}</h1>
        ${onPage}
        <article class="prose doc-body">
${body}
        </article>
        <p class="quiet doc-source">This page is <a href="${BLOB}${doc.file}">${doc.file}</a> in the repository. <a href="https://github.com/{{repo}}/edit/main/${doc.file}">Suggest a change</a>.</p>
      </main>
    </div>

    <footer class="footer">
      <div class="footer-inner">
        <p>{{name}} is open source under the GNU AGPL v3 and builds on <a href="https://github.com/microsoft/vscode">VS Code</a>. The Claude and Codex marks belong to their owners.</p>
        <p><a href="https://github.com/{{repo}}">GitHub</a> &nbsp; <a href="https://github.com/{{repo}}/blob/main/CONTRIBUTING.md">Contributing</a> &nbsp; <a href="https://github.com/{{repo}}/blob/main/SECURITY.md">Security</a> &nbsp; <a href="${depth}docs/privacy/">Privacy</a></p>
      </div>
    </footer>
    <script type="module" src="/src/docs.ts"></script>
  </body>
</html>
`
}

rmSync(OUT, { recursive: true, force: true })
for (const doc of DOCS) {
	const file = join(OUT, doc.slug, 'index.html')
	mkdirSync(dirname(file), { recursive: true })
	writeFileSync(file, page(doc, render(doc)))
}
console.log(`docs pages: ${DOCS.length} → ${OUT}`)
