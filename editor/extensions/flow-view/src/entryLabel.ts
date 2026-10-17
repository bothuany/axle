/*---------------------------------------------------------------------------------------------
 *  Axle: how an endpoint is shown in a list. A developer reads the route first; the handler and
 *  where it lives come second. The handler names the index builds are made for matching, not for
 *  reading: `Order.place` (class shortened, easy to take for the `Order` entity), `main.create_invoice`
 *  (every Python service has a `main`), `server./bff/checkout` (an inline handler). Pure (no vscode).
 *--------------------------------------------------------------------------------------------*/

export interface EntryLike {
	http: string;
	controller: string;
	action: string;
	file: string;
}

/**
 * `title`: the route as declared ("POST /invoices"). `detail`: the service folder, when the workspace holds several
 * (the first folder of `relFile`, if the file is nested at least two deep), then the handler: `Class.method` as
 * written, a module-level function by its name, an inline handler by its file.
 */
export function entryDisplay(e: EntryLike, relFile: string): { title: string; detail: string } {
	const parts = relFile.split(/[\\/]/).filter(Boolean);
	const service = parts.length > 2 ? parts[0] : '';
	const file = parts.at(-1) ?? relFile;
	const inline = e.action.startsWith('/') || e.action === '' || /^[A-Z]+ \//.test(e.action);
	const classBased = /^[A-Z]/.test(e.controller) && !inline;
	const handler = inline ? file : classBased ? `${e.controller}.${e.action}` : e.action;
	return { title: e.http, detail: service ? `${service} · ${handler}` : handler };
}
