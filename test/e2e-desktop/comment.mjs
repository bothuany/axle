#!/usr/bin/env node
// Turns the results of a desktop-e2e run into the one PR comment (created once, then updated): a pass/fail table and a gallery
// of the screenshots. Screenshots are pushed to the `e2e-shots` branch and linked by their raw URL, because a workflow artifact
// cannot be embedded in a comment (downloading it needs a login). On a fork's PR the token cannot write: the table still goes
// to the job summary and the comment links the artifacts.
//   node comment.mjs --in <folder with one subfolder per run> --run-url <url> [--pr <number>] [--repo owner/name] [--publish] [--body <file>]
// Environment: GH_TOKEN (the workflow's token), GITHUB_STEP_SUMMARY, GITHUB_RUN_ID.
import { execFileSync } from 'node:child_process'
import { appendFileSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { table } from './lib/results.mjs'

export const MARKER = '<!-- axle-desktop-e2e -->'
const BRANCH = 'e2e-shots'
const KEEP_RUNS = 15

/** The runs found under `dir`: each subfolder that holds a results.json. */
export function readRuns(dir) {
	return readdirSync(dir, { withFileTypes: true }).filter(e => e.isDirectory() && existsSync(join(dir, e.name, 'results.json'))).map(e => ({ folder: e.name, ...JSON.parse(readFileSync(join(dir, e.name, 'results.json'), 'utf8')) })).sort((a, b) => a.label.localeCompare(b.label))
}

/** The comment's text. `rawBase` is where the screenshots can be fetched from (undefined: they were not published). */
export function buildBody({ runs, runUrl, rawBase, sha }) {
	const failed = runs.flatMap(r => r.scenarios.filter(s => s.status === 'fail').map(s => `${r.label}: ${s.title}`))
	const head = failed.length ? `**Desktop e2e failed** (${failed.length}): ${failed.join('; ')}` : '**Desktop e2e passed**'
	const lines = [MARKER, `### Desktop e2e${sha ? ` (${sha.slice(0, 7)})` : ''}`, '', head, '', table(runs), '']
	const gallery = runs.flatMap(r => r.scenarios.flatMap(s => (s.shots ?? []).map(f => ({ run: r, scenario: s, file: f }))))
	if (gallery.length && rawBase) {
		lines.push('<details open><summary>Screenshots</summary>', '')
		for (const { run, scenario, file } of gallery) {
			lines.push(`**${run.label}: ${scenario.title}** (\`${file.replace(/^shots\//, '')}\`)`, '', `<img src="${rawBase}/${run.label}/${file}" width="520">`, '')
		}
		lines.push('</details>', '')
	} else if (gallery.length) {
		lines.push(`${gallery.length} screenshots are in the run's artifacts (this run could not publish them).`, '')
	}
	lines.push(`[Run, logs and artifacts](${runUrl})`)
	return lines.join('\n')
}

const gh = (args, input) => execFileSync('gh', args, { encoding: 'utf8', input, stdio: ['pipe', 'pipe', 'inherit'] })
const git = (cwd, args) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] })

/** Pushes the screenshots to the e2e-shots branch under <runId>/<label>/shots and returns their base URL. */
function publish({ runs, dir, repo, token, runId }) {
	const work = mkdtempSync(join(tmpdir(), 'axle-shots-'))
	try {
		const url = `https://github.com/${repo}.git`
		const auth = ['-c', `http.extraheader=AUTHORIZATION: basic ${Buffer.from(`x-access-token:${token}`).toString('base64')}`]
		try {
			execFileSync('git', [...auth, 'clone', '--quiet', '--depth', '1', '--branch', BRANCH, url, work], { stdio: 'ignore' })
		} catch {
			git(work, ['init', '-q', '-b', BRANCH])
			git(work, ['remote', 'add', 'origin', url])
		}
		// Old runs go: the branch is a gallery for open PRs, not an archive.
		const old = existsSync(work) ? readdirSync(work).filter(n => /^\d+$/.test(n)).sort((a, b) => Number(a) - Number(b)) : []
		for (const n of old.slice(0, Math.max(0, old.length - KEEP_RUNS + 1))) {
			rmSync(join(work, n), { recursive: true, force: true })
		}
		for (const run of runs) {
			const target = join(work, String(runId), run.label)
			mkdirSync(target, { recursive: true })
			if (existsSync(join(dir, run.folder, 'shots'))) {
				cpSync(join(dir, run.folder, 'shots'), join(target, 'shots'), { recursive: true })
			}
		}
		git(work, ['add', '-A'])
		git(work, ['-c', 'user.name=github-actions', '-c', 'user.email=41898282+github-actions[bot]@users.noreply.github.com', 'commit', '-q', '-m', `Screenshots of desktop-e2e run ${runId}`])
		git(work, [...auth, 'push', '--quiet', 'origin', `HEAD:refs/heads/${BRANCH}`])
		return `https://raw.githubusercontent.com/${repo}/${BRANCH}/${runId}`
	} finally {
		rmSync(work, { recursive: true, force: true })
	}
}

/** Updates the comment that carries MARKER, or adds one. */
function post({ repo, pr, body }) {
	const comments = JSON.parse(gh(['api', '--paginate', '--slurp', `repos/${repo}/issues/${pr}/comments`])).flat()
	const mine = comments.find(c => c.body?.includes(MARKER))
	if (mine) {
		gh(['api', '--method', 'PATCH', `repos/${repo}/issues/comments/${mine.id}`, '--input', '-'], JSON.stringify({ body }))
	} else {
		gh(['api', '--method', 'POST', `repos/${repo}/issues/${pr}/comments`, '--input', '-'], JSON.stringify({ body }))
	}
}

function main() {
	const o = {}
	const argv = process.argv.slice(2)
	for (let i = 0; i < argv.length; i++) {
		o[argv[i].slice(2)] = argv[i + 1]?.startsWith('--') || argv[i + 1] === undefined ? true : argv[++i]
	}
	const dir = resolve(String(o.in ?? 'e2e-results'))
	const runs = readRuns(dir)
	if (!runs.length) {
		throw new Error(`No results.json under ${dir}: the jobs that make them did not finish.`)
	}
	const runId = process.env.GITHUB_RUN_ID ?? String(Date.now())
	const repo = String(o.repo ?? process.env.GITHUB_REPOSITORY ?? '')
	let rawBase
	if (o.publish) {
		try {
			rawBase = publish({ runs, dir, repo, token: process.env.GH_TOKEN, runId })
		} catch (e) {
			console.warn(`Could not publish the screenshots (${e.message.split('\n')[0]}); the comment links the artifacts instead.`)
		}
	}
	const body = buildBody({ runs, runUrl: String(o['run-url'] ?? ''), rawBase, sha: process.env.GITHUB_SHA })
	if (o.body) {
		writeFileSync(String(o.body), body)
	}
	if (process.env.GITHUB_STEP_SUMMARY) {
		appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${body}\n`)
	}
	if (o.pr && o.pr !== true) {
		try {
			post({ repo, pr: String(o.pr), body })
			console.log(`Commented on ${repo}#${o.pr}`)
		} catch (e) {
			console.warn(`Could not comment (${e.message.split('\n')[0]}); the table is in the job summary.`)
		}
	}
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	try {
		main()
	} catch (e) {
		console.error(e.message)
		process.exit(1)
	}
}
