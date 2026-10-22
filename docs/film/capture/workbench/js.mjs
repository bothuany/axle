// Sends a snippet (file or inline code) to the workbench driver and prints the result.
//   node js.mjs <file.js|code>          node js.mjs cmd "<palette title>" ["<pick>"]
import { readFileSync } from 'node:fs'
const [a, ...rest] = process.argv.slice(2)
let code
if (a === 'cmd') code = `const CMD = ${JSON.stringify(rest[0])}, PICK = ${JSON.stringify(rest[1] ?? null)};\n` + readFileSync(new URL('./cmd.js', import.meta.url), 'utf8')
else code = a.endsWith('.js') ? readFileSync(a, 'utf8') : a
const r = await fetch('http://127.0.0.1:7311/?js=' + encodeURIComponent(code))
console.log(await r.text())
