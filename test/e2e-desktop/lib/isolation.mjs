// The desktop e2e tests open real windows and move the real pointer. They run inside Docker or Windows Sandbox,
// never on a developer's desktop, and this is what stops a stray `node run.mjs` from doing it there.

/** Why this process may not open windows, or '' when it may. `env` is injectable for tests. */
export function refusal(env = process.env) {
	if (env.INSILODE_E2E_ISOLATED === '1') {
		return ''
	}
	return [
		'Refusing to open Insilode windows: the desktop e2e tests take over the screen and the pointer.',
		'They run in Docker (npm run docker:e2e) or inside Windows Sandbox (npm run sandbox:e2e).',
		'On a throwaway machine you own, set INSILODE_E2E_ISOLATED=1 to run them anyway.',
	].join('\n')
}
