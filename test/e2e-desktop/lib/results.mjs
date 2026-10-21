// What a run leaves behind: results.json (read by the PR comment and the sandbox launcher) and screenshots next to it.
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

export class Results {
	constructor(label, out) {
		this.label = label
		this.out = out
		this.scenarios = []
		mkdirSync(join(out, 'shots'), { recursive: true })
	}

	/** Records one scenario. status: pass | fail | skip. */
	add(scenario) {
		this.scenarios.push(scenario)
		writeFileSync(join(this.out, 'results.json'), JSON.stringify(this.toJSON(), null, 2))
		const mark = { pass: 'PASS', fail: 'FAIL', skip: 'SKIP' }[scenario.status]
		console.log(`[${this.label}] ${mark}  ${scenario.title}${scenario.detail ? ` - ${scenario.detail}` : ''}`)
	}

	get failed() {
		return this.scenarios.some(s => s.status === 'fail')
	}

	toJSON() {
		return { label: this.label, at: new Date().toISOString(), scenarios: this.scenarios }
	}
}
