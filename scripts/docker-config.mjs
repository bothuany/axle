// What scripts/docker-e2e.mjs asks Docker for, without touching Docker: the `docker run` arguments and the image name. Pure, so
// test/e2e-desktop/unit tests the promise that matters: nothing of the host's screen, network or input is shared with the container.
import { createHash } from 'node:crypto'

/** The named volume that holds the copy of Insilode and the VS Code build between runs. */
export const WORK_VOLUME = 'insilode-e2e-work'

/** The image's tag: it changes with the Dockerfile and the entrypoint, so an edit to either rebuilds it. */
export function imageTag(dockerfile, entrypoint) {
	return `insilode-e2e:${createHash('sha256').update(dockerfile).update(entrypoint).digest('hex').slice(0, 12)}`
}

/**
 * `docker run` arguments. The repository is mounted read-only, the control folder read-only and the output folder read-write.
 * No published ports, no host network, no X11 socket, no DISPLAY: the container draws on its own virtual display (xvfb).
 */
export function dockerRunArgs({ image, name, repo, ctl, out, probeDir, mode, modeArgs = [], volume = WORK_VOLUME, memory = '8g' }) {
	return [
		'run', '--rm', '--name', name,
		'--shm-size', '2g', '--memory', memory,
		'-v', `${volume ?? WORK_VOLUME}:/work/insilode`,
		'-v', `${repo}:/src:ro`,
		'-v', `${ctl}:/ctl:ro`,
		'-v', `${out}:/out`,
		...(probeDir ? ['-v', `${probeDir}:/probe:ro`] : []),
		image, mode, ...modeArgs,
	]
}

/** What to tell someone whose Docker is not there or not running. */
export function dockerMissingMessage(detail) {
	return [
		`Docker is not available: ${detail}`,
		'Install and start Docker Desktop (Linux containers), then run this again. Desktop tests never run on your own desktop.',
		'On Windows, the Windows-only scenarios can run in Windows Sandbox instead (npm run sandbox:e2e).',
	].join('\n')
}

/**
 * The files whose size or modification time differ from what the last run copied. Copying only those keeps a run on an unchanged
 * tree from stat-ing every file through the container's bind mount (a minute on Docker Desktop). `previous` and `now` map a path
 * to "<mtimeMs>:<size>".
 */
export function changedFiles(now, previous) {
	return Object.keys(now).filter(file => previous?.[file] !== now[file])
}
