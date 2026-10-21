/*---------------------------------------------------------------------------------------------
 *  Axle skeleton first: file changes come in bursts (typing, a save, a formatter, an agent writing several files), and the board
 *  should follow within a second without re-reading on every keystroke. This keeps the latest item per file and hands the batch over
 *  once nothing new has come for `delay` ms. Pure: no vscode, no fs.
 *--------------------------------------------------------------------------------------------*/

export class ChangeBatcher<T> {
	private pending = new Map<string, T>();
	private timer: ReturnType<typeof setTimeout> | undefined;

	constructor(private readonly delay: number, private readonly flush: (batch: Map<string, T>) => void | Promise<void>, private readonly onError: (e: unknown) => void = () => undefined) { }

	/** `key` is the file (compare-safe: the caller normalises it); a later `item` for the same key replaces the earlier one. */
	add(key: string, item: T) {
		this.pending.set(key, item);
		clearTimeout(this.timer);
		this.timer = setTimeout(() => this.run(), this.delay);
	}

	/** Whether something is waiting for its turn. */
	get waiting() {
		return this.pending.size > 0;
	}

	private run() {
		const batch = this.pending;
		this.pending = new Map();
		this.timer = undefined;
		void Promise.resolve().then(() => this.flush(batch)).catch(e => this.onError(e));
	}

	dispose() {
		clearTimeout(this.timer);
		this.pending.clear();
	}
}
