/*---------------------------------------------------------------------------------------------
 *  Settings written before the rename (Axle -> Insilode). They live in the user's own settings.json and in the
 *  workspaces' .vscode/settings.json, so they are moved to the new names once, in the scope they were set in.
 *  The old key stays in the file (nothing is deleted from a file the user owns).
 *
 *  Pure (no vscode): `read` is `getConfiguration().inspect(key)`, the result is what to write. Tested on its own.
 *--------------------------------------------------------------------------------------------*/

export type Scope = 'global' | 'workspace' | 'folder';
export const SCOPES: readonly Scope[] = ['global', 'workspace', 'folder'];

export interface Inspected {
	globalValue?: unknown;
	workspaceValue?: unknown;
	workspaceFolderValue?: unknown;
}

export interface SettingUpdate {
	key: string;
	scope: Scope;
	value: unknown;
}

const valueIn = (i: Inspected | undefined, scope: Scope): unknown =>
	scope === 'global' ? i?.globalValue : scope === 'workspace' ? i?.workspaceValue : i?.workspaceFolderValue;

const THEMES: Record<string, string> = { 'Axle Dark': 'Insilode Dark', 'Axle Light': 'Insilode Light' };
const THEME_KEYS = ['workbench.colorTheme', 'workbench.preferredDarkColorTheme', 'workbench.preferredLightColorTheme'];
const AUTO_HIDE = 'flow.agents.desktop.overlay.autoHide';

export function legacySettingUpdates(read: (key: string) => Inspected | undefined): SettingUpdate[] {
	const updates: SettingUpdate[] = [];
	for (const scope of SCOPES) {
		const at = (key: string) => valueIn(read(key), scope);

		const skeleton = at('axle.skeletonFirst.enabled');
		if (typeof skeleton === 'boolean' && at('insilode.skeletonFirst.enabled') === undefined) {
			updates.push({ key: 'insilode.skeletonFirst.enabled', scope, value: skeleton });
		}

		if (at('flow.agents.desktop.overlay.display') === 'axle') {
			updates.push({ key: 'flow.agents.desktop.overlay.display', scope, value: 'insilode' });
		}

		const hide = at(AUTO_HIDE);
		if (hide && typeof hide === 'object' && 'axleFocused' in hide) {
			const { axleFocused, ...rest } = hide as Record<string, unknown>;
			updates.push({ key: AUTO_HIDE, scope, value: { ...rest, insilodeFocused: (rest.insilodeFocused ?? axleFocused) } });
		}

		for (const key of THEME_KEYS) {
			const theme = at(key);
			if (typeof theme === 'string' && THEMES[theme]) {
				updates.push({ key, scope, value: THEMES[theme] });
			}
		}
	}
	return updates;
}
