// The smallest probe: start Axle on the demo project, open the Command Palette, take two screenshots.
//   npm run docker:e2e -- --probe test/e2e-desktop/probes/hello.mjs
// Copy it and change the middle to probe your own change (see docs/building.md, "Probing and testing the app without taking over your screen").
import { startAxle, shot, runCommand, sleep } from '/work/axle/test/e2e-desktop/lib/probe.mjs'

const { app, page } = await startAxle()
console.log('title:', await page.title())
console.log('screenshot:', await shot(page, 'hello-start'))
await runCommand(page, 'Axle: Show Flow at Cursor').catch(e => console.log('command:', e.message))
await sleep(3000)
console.log('screenshot:', await shot(page, 'hello-after'))
await app.close()
