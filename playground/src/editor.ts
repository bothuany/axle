// A code tab of the workbench: Monaco (the editor VS Code is made of) on one file of the demo project, read-only, or its diff when
// the agent has changed it. Axle's own theme colours come from the captured theme variables. One iframe per tab.
// @ts-expect-error The module's types are in editor.api, imported next as types only; this import is the runtime the canvas page shares.
import * as runtime from '../../ui/node_modules/monaco-editor'
import type * as api from '../../ui/node_modules/monaco-editor/esm/vs/editor/editor.api'
import editorWorker from '../../ui/node_modules/monaco-editor/esm/vs/editor/editor.worker?worker&inline'
import './theme/vscode-theme.css'
import { workbench } from './bridge'
import type { DemoData, DemoFile } from './demo'

// The package ships its types in editor.api; the runtime import is the same module the canvas page uses.
const monaco = runtime as unknown as typeof api
;(self as unknown as { MonacoEnvironment: unknown }).MonacoEnvironment = { getWorker: () => new editorWorker() }

const css = getComputedStyle(document.documentElement)
const v = (name: string, fallback: string) => css.getPropertyValue(`--vscode-${name}`).trim() || fallback
/** Monaco wants #rrggbb[aa]; the captured variables are rgb()/rgba() or hex. */
function hex(color: string): string {
  const m = /^rgba?\(([^)]+)\)$/.exec(color)
  if (!m) return color
  const [r, g, b, a] = m[1].split(',').map(s => Number(s.trim()))
  const h = (n: number) => Math.round(n).toString(16).padStart(2, '0')
  return `#${h(r)}${h(g)}${h(b)}${a === undefined || a === 1 ? '' : h(a * 255)}`
}
const color = (name: string, fallback: string) => hex(v(name, fallback))

// Axle Dark's token colours (editor/extensions/flow-theme/themes/flow-dark.json), in Monaco's token names.
monaco.editor.defineTheme('axle-dark', {
  base: 'vs-dark',
  inherit: true,
  rules: [
    { token: 'comment', foreground: '6a6a6a', fontStyle: 'italic' },
    { token: 'keyword', foreground: 'b88cff' },
    { token: 'keyword.flow', foreground: 'b88cff' },
    { token: 'type', foreground: '62d6e8' },
    { token: 'type.identifier', foreground: '62d6e8' },
    { token: 'string', foreground: '8fe0b0' },
    { token: 'string.escape', foreground: '8fe0b0' },
    { token: 'number', foreground: 'ff9e64' },
    { token: 'identifier', foreground: 'e0e0e0' },
    { token: 'annotation', foreground: '8ea6ff' },
    { token: 'delimiter', foreground: '8a8a8a' },
    { token: 'operator', foreground: '8a8a8a' },
    { token: 'predefined', foreground: '8ea6ff' },
    { token: 'tag', foreground: 'ff6b7d' },
    { token: 'attribute.name', foreground: '4fd6d0' },
    { token: 'attribute.value', foreground: '8fe0b0' },
  ],
  colors: {
    'editor.background': color('editor-background', '#0f0f0f'),
    'editor.foreground': color('editor-foreground', '#e0e0e0'),
    'editorLineNumber.foreground': color('editorLineNumber-foreground', '#4b4b4b'),
    'editorLineNumber.activeForeground': color('editorLineNumber-activeForeground', '#b0b0b0'),
    'editor.lineHighlightBackground': color('editor-lineHighlightBackground', '#ffffff08'),
    'editor.selectionBackground': color('editor-selectionBackground', '#6f86ff40'),
    'editorCursor.foreground': color('editorCursor-foreground', '#6f86ff'),
    'editorIndentGuide.background1': color('editorIndentGuide-background1', '#ffffff10'),
    'editorGutter.background': color('editorGutter-background', '#0f0f0f'),
    'diffEditor.insertedTextBackground': color('diffEditor-insertedTextBackground', '#5fe0a122'),
    'diffEditor.removedTextBackground': color('diffEditor-removedTextBackground', '#ff6b7d22'),
    'diffEditor.insertedLineBackground': color('diffEditor-insertedLineBackground', '#5fe0a114'),
    'diffEditor.removedLineBackground': color('diffEditor-removedLineBackground', '#ff6b7d14'),
    'scrollbarSlider.background': color('scrollbarSlider-background', '#ffffff1a'),
    'scrollbarSlider.hoverBackground': color('scrollbarSlider-hoverBackground', '#ffffff2a'),
  },
})

const params = new URLSearchParams(location.search)
const path = params.get('path') ?? ''
const wantDiff = params.get('diff') === '1'
let line = Number(params.get('line')) || 0

const language = (p: string) => (p.endsWith('.java') ? 'java' : p.endsWith('.py') ? 'python' : p.endsWith('.md') ? 'markdown' : p.endsWith('.json') ? 'json' : 'plaintext')
const options: api.editor.IStandaloneEditorConstructionOptions = {
  theme: 'axle-dark',
  readOnly: true,
  domReadOnly: true,
  automaticLayout: true,
  minimap: { enabled: false },
  fontFamily: 'ui-monospace, "Cascadia Code", Menlo, Consolas, monospace',
  fontSize: 13,
  lineHeight: 20,
  scrollBeyondLastLine: false,
  renderLineHighlight: 'line',
  padding: { top: 8 },
  scrollbar: { verticalScrollbarSize: 10, horizontalScrollbarSize: 10 },
  guides: { indentation: true },
  contextmenu: false,
}

const data: DemoData = await fetch('./data/demo.json').then(r => r.json())
const file: DemoFile | undefined = data.files.find(f => f.path === path)
const host = document.getElementById('editor')!
host.style.cssText = 'position:absolute;inset:0'
if (!file) {
  host.textContent = `${path} is not part of the demo project.`
} else {
  const lang = language(file.path)
  const edited = () => workbench()?.edited() ?? false
  const textNow = () => (edited() && file.after !== undefined ? file.after : file.text)
  let editor: api.editor.IStandaloneCodeEditor | undefined
  let diff: api.editor.IStandaloneDiffEditor | undefined
  const models: api.editor.ITextModel[] = []

  const draw = () => {
    editor?.dispose()
    diff?.dispose()
    models.splice(0).forEach(m => m.dispose())
    editor = diff = undefined
    // The diff of a file the agent changed: before on the left, the working tree on the right, like the Source Control view's diff.
    if (wantDiff && file.after !== undefined && edited()) {
      const original = monaco.editor.createModel(file.text, lang)
      const modified = monaco.editor.createModel(file.after, lang)
      models.push(original, modified)
      diff = monaco.editor.createDiffEditor(host, { ...options, renderSideBySide: host.clientWidth > 900, originalEditable: false })
      diff.setModel({ original, modified })
      return
    }
    const model = monaco.editor.createModel(textNow(), lang)
    models.push(model)
    editor = monaco.editor.create(host, { ...options, model })
    if (line > 0) {
      editor.revealLineInCenter(line)
      editor.setPosition({ lineNumber: line, column: 1 })
    }
  }
  draw()
  // The workbench tells a tab when the files change under it (the agent's edit, Undo) or when to show another line.
  window.addEventListener('message', e => {
    if (e.origin !== location.origin) return
    const m = e.data as { type?: string; line?: number }
    if (m?.type === 'files') draw()
    if (m?.type === 'reveal' && typeof m.line === 'number') {
      line = m.line
      editor?.revealLineInCenter(line)
      editor?.setPosition({ lineNumber: line, column: 1 })
    }
  })
}
