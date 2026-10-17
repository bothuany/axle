/*---------------------------------------------------------------------------------------------
 *  Axle polyglot index: messages that cross a process boundary. A producer names its destination only
 *  as a string (`kafkaTemplate.send("orders", …)`); when a listener of the same index consumes that
 *  topic or queue, the flow can go on into it. Like the HTTP links (links.ts) this is always a guess:
 *  brokers route by configuration the code does not show (exchanges, bindings, consumer groups).
 *
 *  A destination is matched by its exact name. A name that is not all written out (a `${app.topic}`
 *  property placeholder, an f-string, a concatenation) links nowhere: guessing which topic it means
 *  would draw edges that are more often wrong than right.
 *
 *  Pure (no tree-sitter, no files), so it is tested on its own.
 *--------------------------------------------------------------------------------------------*/

import type { Ann, CallFact } from './model';

export interface MessageSend {
	/** Destinations this call may send to, as written; several when the call does not say which argument names it. */
	keys: string[];
	/** A Celery task called through its function (`send_email.delay(…)`): the receiver to resolve as a function. */
	task?: string;
	/** For the card: kafka, rabbit, jms, stream, celery, nest. */
	via: string;
}

/** Spring's messaging templates, by declared type or (when the type is unknown) by field name. */
const JAVA_SENDERS: { type: RegExp; name: RegExp; methods: Set<string>; via: string; keys: 1 | 2 }[] = [
	{ type: /^(KafkaTemplate|KafkaOperations)$/, name: /kafka\w*template$/i, methods: new Set(['send']), via: 'kafka', keys: 1 },
	// convertAndSend(routingKey, msg) or convertAndSend(exchange, routingKey, msg): either of the first two may name the queue.
	{ type: /^(RabbitTemplate|RabbitOperations|AmqpTemplate|RabbitMessagingTemplate)$/, name: /(rabbit|amqp)\w*template$/i, methods: new Set(['convertAndSend', 'send']), via: 'rabbit', keys: 2 },
	{ type: /^(JmsTemplate|JmsOperations|JmsMessagingTemplate)$/, name: /jms\w*template$/i, methods: new Set(['convertAndSend', 'send']), via: 'jms', keys: 1 },
	{ type: /^StreamBridge$/, name: /streamBridge$/i, methods: new Set(['send']), via: 'stream', keys: 1 },
	{ type: /^(QueueMessagingTemplate|SqsTemplate)$/, name: /(sqs|queueMessaging)\w*template$/i, methods: new Set(['convertAndSend', 'send']), via: 'sqs', keys: 1 },
];

const PY_PRODUCER = /(^|\.)\w*producer$/i;
const JS_PRODUCER = /(^|\.)\w*producer$/i;
const NEST_CLIENT = /(^|\.)\w*(client|proxy)$/i;

/** A destination name written out in full: no placeholder, interpolation or concatenated part. */
function written(s: string | undefined): string | undefined {
	const t = s?.trim();
	return t && t === s && !/[\s{}$]/.test(t) && !t.includes('…') ? t : undefined;
}

/** The literal a string-literal argument holds (`"orders"`, `'orders'`), or undefined for anything else. */
function literal(raw: string | undefined): string | undefined {
	const m = raw && /^(?:[rbu]{0,2})(["'`])([^"'`\\]*)\1$/i.exec(raw.trim());
	return m && !(m[1] === '`' && m[2].includes('${')) ? m[2] : undefined;
}

/**
 * The message a call sends, if it is one: by the sender's type or name and method, per language.
 * `typeOf` names the receiver's declared type when the index knows it; `constOf` reads a constant
 * (`send(TOPIC, …)` with `static final String TOPIC = "orders"`).
 */
export function messageSendOf(lang: string, c: CallFact, typeOf?: (recv: string) => string | undefined, constOf?: (expr: string) => string | undefined): MessageSend | undefined {
	if (!c.recv) {
		return undefined;
	}
	const first = () => written(literal(c.arg0) ?? (c.arg0 && /^[\w.]+$/.test(c.arg0) ? constOf?.(c.arg0) : undefined));
	if (lang === 'java') {
		const type = typeOf?.(c.recv);
		const s = JAVA_SENDERS.find(x => x.methods.has(c.name) && (type ? x.type.test(type) : x.name.test(c.recv!)));
		if (!s) {
			return undefined;
		}
		const keys = [first()];
		if (s.keys === 2) {
			// The second destination argument is only known when the first one is a literal (then it is the next literal).
			keys.push(literal(c.arg0) !== undefined ? written(c.strings[1]) : undefined);
		}
		const out = keys.filter((k): k is string => !!k);
		return out.length ? { keys: [...new Set(out)], via: s.via } : undefined;
	}
	if (lang === 'python') {
		if (c.name === 'delay' || c.name === 'apply_async') {
			return /^[A-Za-z_][\w.]*$/.test(c.recv) ? { keys: [], task: c.recv, via: 'celery' } : undefined;
		}
		const via = c.name === 'send_task' ? 'celery' : PY_PRODUCER.test(c.recv) && (c.name === 'send' || c.name === 'produce') ? 'kafka' : undefined;
		const key = via && first();
		return key ? { keys: [key], via: via! } : undefined;
	}
	if (lang === 'js') {
		// kafkajs: producer.send({ topic: 'orders', messages: [...] }); the topic sits in an object, so read it from the raw argument.
		if (JS_PRODUCER.test(c.recv) && c.name === 'send' && c.arg0?.trimStart().startsWith('{')) {
			const key = written(/\btopic\s*:\s*(["'`])([^"'`]*)\1/.exec(c.arg0)?.[2]);
			return key ? { keys: [key], via: 'kafka' } : undefined;
		}
		// NestJS ClientProxy: this.client.emit('order.created', data) reaches @EventPattern('order.created').
		if (NEST_CLIENT.test(c.recv) && (c.name === 'emit' || c.name === 'send')) {
			const key = first();
			return key ? { keys: [key], via: 'nest' } : undefined;
		}
	}
	return undefined;
}

/** Every string literal in an annotation argument: `"orders"`, `{"a", "b"}`, `["a", "b"]`. */
function literalsIn(raw: string | undefined): string[] {
	return raw ? [...raw.matchAll(/"([^"\\]*)"|'([^'\\]*)'/g)].map(m => m[1] ?? m[2]) : [];
}

/**
 * The destinations a listener consumes: Spring `@KafkaListener(topics = …)`, `@RabbitListener(queues = …)`,
 * `@JmsListener(destination = …)`, `@SqsListener("q")`, `@StreamListener("binding")`, NestJS
 * `@EventPattern('x')` / `@MessagePattern('x')`. A constant (`Topics.ORDERS`) is read through `constOf`;
 * placeholders (`${app.topic}`) are left out.
 */
export function listenerKeys(a: Ann, constOf?: (expr: string) => string | undefined): string[] {
	const raw = a.named.topics ?? a.named.queues ?? a.named.destination ?? a.named.queueNames ?? a.named.value ?? (a.args[0] && !a.args[0].includes('=') ? a.args[0] : undefined);
	const names = literalsIn(raw);
	if (raw && constOf) {
		// The items that are not literals: `{Topics.ORDERS, "audit"}` → Topics.ORDERS.
		const rest = raw.replace(/"[^"\\]*"|'[^'\\]*'/g, '').replace(/^\s*[{[]|[}\]]\s*$/g, '');
		names.push(...rest.split(',').map(x => x.trim()).filter(x => /^[A-Za-z_][\w.]*$/.test(x)).map(x => constOf(x) ?? ''));
	}
	return [...new Set(names.map(written).filter((k): k is string => !!k))];
}

/** A Celery task's names: `@app.task(name="x")`, else Celery's default `module.function`. */
export function celeryTaskNames(a: Ann, module: string | undefined, fn: string): string[] {
	const named = written(literal(a.named.name));
	return named ? [named] : [module ? `${module}.${fn}` : fn];
}

/**
 * The consumers a send may reach. Destinations match exactly; a Celery task name also matches on a dotted
 * suffix (`send_task("tasks.add")` against `proj.tasks.add`), since the module path the index computes
 * starts wherever the workspace does. A topic with several listeners reaches all of them (fan-out).
 */
export function matchConsumers<C extends { keys: string[]; celery?: boolean }>(send: MessageSend, consumers: C[]): C[] {
	const dotted = (a: string, b: string) => a === b || a.endsWith(`.${b}`) || b.endsWith(`.${a}`);
	return consumers.filter(c => send.keys.some(k => c.keys.some(ck => (c.celery && send.via === 'celery' ? dotted(ck, k) : ck === k))));
}
