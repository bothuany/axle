/*---------------------------------------------------------------------------------------------
 *  Insilode polyglot index: calls that cross a process boundary. An HTTP client call names its target
 *  only as a string ("/api/orders/{…}"); when an endpoint of the same index serves that route, the
 *  flow can go on into it. Matching is by the literal path segments, so it is always a guess: the
 *  base URL (often an environment variable) and which service answers are not known statically.
 *
 *  Pure (no tree-sitter, no files), so it is tested on its own.
 *--------------------------------------------------------------------------------------------*/

import type { CallFact } from './model';

export interface HttpCall {
	/** GET, POST, …; null when the call does not say (fetch with an options object, exchange). */
	verb: string | null;
	/** Path segments; '*' stands for a parameter or an unknown part. */
	segments: string[];
	/** The URL began with something not written out (a base URL variable): match the route's tail. */
	openStart: boolean;
	/** The URL as written, for the card. */
	url: string;
}

const VERBS = new Set(['get', 'post', 'put', 'patch', 'delete', 'head']);
const REST_TEMPLATE: Record<string, string | null> = {
	getForObject: 'GET', getForEntity: 'GET',
	postForObject: 'POST', postForEntity: 'POST', postForLocation: 'POST',
	patchForObject: 'PATCH', put: 'PUT', delete: 'DELETE', exchange: null,
};

/** Receivers that are HTTP clients, by name: `axios`, `this.http`, `self.session`, `httpClient`, `requests`. */
const JS_CLIENT = /(^|\.)(axios|http|httpClient|api|apiClient|client|ky|got|superagent|\$http)$/i;
const PY_CLIENT = /(^|\.)(requests|httpx|session|client|http|http_client|async_client|aiohttp)$/i;
const JAVA_TEMPLATE = /(^|\.)\w*(restTemplate|template)$/i;
const JAVA_FLUENT = /(^|\.)\w*(webClient|restClient|client)$/i;
/** Declared types that are Spring HTTP clients: the receiver's name then does not matter (`rest`, `billing`, `http`). */
const JAVA_TEMPLATE_TYPE = /^(RestTemplate|RestOperations|TestRestTemplate)$/;
const JAVA_FLUENT_TYPE = /^(WebClient|RestClient)$/;
/** RestTemplate methods no other common type has: the call is HTTP whatever the receiver is called or typed. */
const REST_TEMPLATE_ONLY = new Set(['getForObject', 'getForEntity', 'postForObject', 'postForEntity', 'postForLocation', 'patchForObject']);
/** What ends a WebClient/RestClient request chain: `.uri(...)` and then one of these. */
const FLUENT_END = new Set(['retrieve', 'exchange', 'exchangeToMono', 'exchangeToFlux', 'toEntity', 'body', 'bodyToMono', 'bodyToFlux']);

const isVerb = (name: string | undefined) => !!name && VERBS.has(name.toLowerCase());
/** The verb a call names (`Get`, `post`), else the first verb chained onto it: `client.R().Post(url)`. */
const verbIn = (c: CallFact) => isVerb(c.name) ? c.name.toUpperCase() : c.chain?.find(isVerb)?.toUpperCase();
/** `request('POST', url)`, `NewRequest(http.MethodPost, url)`: the method written as the first string (the extractors spell constants as their verb). */
const methodArg = (c: CallFact) => c.strings.find(s => /^[A-Za-z]+$/.test(s) && isVerb(s))?.toUpperCase() ?? null;

const GO_CLIENT = /(^|\.)(http|client|httpClient|DefaultClient|hc|resty)$/i;
const PHP_CLIENT = /(^|\.)(client|http|httpClient|guzzle)$/i;
const RUBY_CLIENT = /(^|\.)@?(conn|connection|client|http|http_client|faraday|api)$/i;
const RUST_CLIENT = /(^|\.)(client|http|http_client|reqwest)$/i;

/**
 * Go, PHP, Ruby and Rust clients: the verb a call sends (null: not said), or undefined if it is not a request.
 * Receivers are as the extractors spell them: `Net.HTTP` (`::` → `.`), `this.client` (`$this->client`), the
 * PHP static scope as written (`Http`, `\Illuminate\Support\Facades\Http`).
 */
const OTHER_CLIENTS: Record<'go' | 'php' | 'ruby' | 'rust', (c: CallFact) => string | null | undefined> = {
	go: c => {
		if (!c.recv || !GO_CLIENT.test(c.recv)) {
			return undefined;
		}
		if (/^(Get|Post|Head|PostForm)$/.test(c.name)) {
			return c.name === 'PostForm' ? 'POST' : c.name.toUpperCase(); // http.Get(url), client.Post(url, ctype, body)
		}
		if (c.name === 'NewRequest' || c.name === 'NewRequestWithContext') {
			return methodArg(c);
		}
		// resty: client.R().SetBody(b).Post(url), resty.New().R().Get(url)
		return c.name === 'R' || (c.name === 'New' && c.chain?.[0] === 'R') ? verbIn({ ...c, name: '' }) : undefined;
	},
	php: c => {
		if (c.recv && /(^|\\)Http$/.test(c.recv)) {
			return verbIn(c); // Http::get(url), Http::withToken($t)->post(url)
		}
		if (c.recv && PHP_CLIENT.test(c.recv)) {
			// Guzzle / Symfony HttpClient: $client->get(url), $client->request('POST', url), getAsync, requestAsync
			const name = c.name.replace(/Async$/, '');
			return name === 'request' ? methodArg(c) : isVerb(name) ? name.toUpperCase() : undefined;
		}
		return undefined;
	},
	ruby: c => {
		if (!c.recv) {
			return undefined;
		}
		const verb = c.name.replace(/_form$/, ''); // Net::HTTP.post_form
		if (/^(HTTParty|RestClient|Faraday|Net\.HTTP|HTTP|Excon|Typhoeus)$/.test(c.recv) || RUBY_CLIENT.test(c.recv)) {
			// HTTParty.get(url), conn.post(url), Faraday.new(url: base).get(path)
			return isVerb(verb) ? verb.toUpperCase() : c.name === 'new' && c.recv === 'Faraday' ? verbIn({ ...c, name: '' }) : undefined;
		}
		const req = /^Net\.HTTP\.(Get|Post|Put|Patch|Delete|Head)$/.exec(c.recv);
		return req && c.name === 'new' ? req[1].toUpperCase() : undefined; // Net::HTTP::Post.new(URI(url))
	},
	rust: c => {
		if (c.recv && /(^|\.)reqwest(\.blocking)?$/.test(c.recv) && c.name === 'get') {
			return 'GET'; // reqwest::get(url)
		}
		if (c.recv && RUST_CLIENT.test(c.recv)) {
			return c.name === 'request' ? methodArg(c) : isVerb(c.name) ? c.name.toUpperCase() : undefined; // client.post(url), client.request(Method::POST, url)
		}
		return undefined;
	},
};

/**
 * The URL argument: the first string that reads like a path or a URL, with at least one written segment.
 * Blanks stay: a concatenation arrives with a blank for each part that is not a literal (`BASE + "/orders"` is
 * " /orders", `"/orders/" + id` is "/orders/ "), and each such blank is a part of the path not written out.
 */
function urlOf(strings: string[]): string | undefined {
	return strings.find(s => /^(https?:\/\/|\/|\{…\}\/|\s+\/)/.test(s) && /[A-Za-z0-9_-]/.test(s.replace(/^https?:\/\/[^/]*/, '').replace(/\{…\}/g, '')));
}

/**
 * The HTTP request a call makes, if it is one: by the client's method and its name or, when the index knows it,
 * the receiver's declared type (`recvType`), per language.
 */
export function httpCallOf(lang: string, c: CallFact, recvType?: string): HttpCall | undefined {
	let verb: string | null | undefined;
	if (lang === 'js') {
		if (c.name === 'fetch' && (!c.recv || c.recv === 'window' || c.recv === 'globalThis')) {
			verb = null;
		} else if (c.recv && JS_CLIENT.test(c.recv) && VERBS.has(c.name.toLowerCase())) {
			verb = c.name.toUpperCase();
		}
	} else if (lang === 'python') {
		if (c.recv && PY_CLIENT.test(c.recv) && VERBS.has(c.name.toLowerCase())) {
			verb = c.name.toUpperCase();
		}
	} else if (lang === 'java') {
		const template = (recvType && JAVA_TEMPLATE_TYPE.test(recvType)) || (c.recv && JAVA_TEMPLATE.test(c.recv));
		const fluent = (recvType && JAVA_FLUENT_TYPE.test(recvType)) || (c.recv && JAVA_FLUENT.test(c.recv)) || c.chain?.some(n => FLUENT_END.has(n));
		if (Object.hasOwn(REST_TEMPLATE, c.name) && (template || REST_TEMPLATE_ONLY.has(c.name))) {
			verb = REST_TEMPLATE[c.name];
		} else if (fluent && VERBS.has(c.name.toLowerCase()) && c.chain?.includes('uri')) {
			verb = c.name.toUpperCase(); // webClient.get().uri("/x").retrieve()
		}
	} else if (lang === 'go' || lang === 'php' || lang === 'ruby' || lang === 'rust') {
		verb = OTHER_CLIENTS[lang](c);
	}
	if (verb === undefined) {
		return undefined;
	}
	const url = urlOf(c.strings);
	if (!url) {
		return undefined;
	}
	const { segments, openStart } = pathSegments(url);
	return segments.some(s => s !== '*') ? { verb, segments, openStart, url } : undefined;
}

/**
 * A path as segments, with every parameter spelling as '*': `{id}`, `:id`, `<int:id>`, `[id]`, `*`, and
 * any segment that is not all written out: an interpolation (`{…}`) or a concatenated variable (a blank,
 * see urlOf) in it. Scheme, host, query and fragment go. `openStart` when the path does not begin with
 * '/' or a host: something unwritten comes first.
 */
export function pathSegments(raw: string): { segments: string[]; openStart: boolean } {
	const unwritten = /^\s/.test(raw); // the literal part of a concatenation that began with a variable
	let p = raw.replace(/[?#].*$/, '').trimStart();
	let openStart = false;
	if (/^https?:\/\//i.test(p)) {
		p = p.replace(/^https?:\/\/[^/]*/i, '');
	} else if (unwritten || !p.startsWith('/')) {
		openStart = true;
	}
	const segments = p.split('/').filter(s => s !== '').map(s => {
		const t = s.trim();
		return !t || /\s|\{…\}/.test(t) || /\S\s|\s\S/.test(s) || /^(\{[^}]*\}|:\w+\??|<[^>]*>|\[[^\]]*\]|\*+)$/.test(t) ? '*' : t.toLowerCase();
	});
	if (openStart && segments[0] === '*') {
		segments.shift(); // `${BASE}/orders` → the base is not a segment of the route
	}
	return { segments, openStart };
}

/** An endpoint's "VERB /route" (the index's `http`), as its verb and segments. */
export function routeOf(http: string): { verb: string; segments: string[] } | undefined {
	const m = /^([A-Z]+|\*)\s+(\S+)/.exec(http.trim());
	return m ? { verb: m[1], segments: pathSegments(m[2]).segments } : undefined;
}

/** Literal against literal must be equal; a parameter on either side takes any one segment. */
function segmentsMatch(call: string[], route: string[]) {
	return call.length === route.length && call.every((s, i) => s === '*' || route[i] === '*' || s === route[i]);
}

/**
 * The endpoints `call` may reach, best first. A path that begins unwritten matches the route's tail.
 * When the verb is known it must agree (an endpoint for every verb, `*`, also does). Among several,
 * the routes that agree on more literal segments win; the rest are dropped.
 */
export function matchEndpoints<E extends { http: string }>(call: HttpCall, entries: E[]): E[] {
	const scored: { e: E; score: number }[] = [];
	for (const e of entries) {
		const r = routeOf(e.http);
		if (!r || (call.verb && r.verb !== '*' && r.verb !== call.verb)) {
			continue;
		}
		const route = call.openStart ? r.segments.slice(Math.max(0, r.segments.length - call.segments.length)) : r.segments;
		if (route.length !== call.segments.length || !segmentsMatch(call.segments, route)) {
			continue;
		}
		scored.push({ e, score: call.segments.filter((s, i) => s !== '*' && s === route[i]).length });
	}
	const best = Math.max(0, ...scored.map(x => x.score));
	return scored.filter(x => x.score === best && best > 0).map(x => x.e);
}
