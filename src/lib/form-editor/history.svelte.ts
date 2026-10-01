// Long enough that a typed word is one step, short enough to feel like the last thing done.
const SETTLE_MS = 400;
const HISTORY_LIMIT = 50;

type Options<S> = {
	/** A deep copy of the live state, so that an entry can never alias it. */
	snapshot: () => S;
	/**
	 * The live state as a string, read reactively. Comparing these is what keeps a no-op edit (a
	 * cancelled drag, retyping the same character) from becoming a history step nobody asked for.
	 */
	serialise: () => string;
	/** Puts an entry back into the live state. */
	restore: (entry: S) => void;
	/** Nothing is banked while this holds. */
	paused: () => boolean;
};

/**
 * Undo and redo over the editor's state. Typing is banked as one step once it settles, and a
 * structural change made through `step` as one of its own. It starts empty, for a restored draft
 * too. Runs an effect, so it has to be created while a component initialises.
 */
export class EditHistory<S> {
	#options: Options<S>;
	#past = $state.raw<S[]>([]);
	#future = $state.raw<S[]>([]);
	#baseline: S;
	#baselineKey = $state('');

	/** The live state, serialised. */
	key = $derived.by(() => this.#options.serialise());
	#pending = $derived(this.key !== this.#baselineKey);

	canUndo = $derived(this.#past.length > 0 || this.#pending);
	// Any unbanked edit invalidates the redo stack, so the button must go dead with it.
	canRedo = $derived(this.#future.length > 0 && !this.#pending);

	constructor(options: Options<S>) {
		this.#options = options;
		this.#baseline = options.snapshot();
		this.#baselineKey = options.serialise();

		// Compare the keys here rather than reading `pending`: the effect has to depend on the text
		// itself, or it never re-runs while a change is outstanding and the wait turns into a fixed
		// interval.
		$effect(() => {
			if (this.key === this.#baselineKey) return;
			const timer = setTimeout(this.checkpoint, SETTLE_MS);
			return () => clearTimeout(timer);
		});
	}

	/** Banks whatever changed since the last step as a step of its own. */
	checkpoint = () => {
		if (this.#options.paused() || !this.#pending) return;
		this.#past = [...this.#past, this.#baseline].slice(-HISTORY_LIMIT);
		this.#future = [];
		this.#baseline = this.#options.snapshot();
		this.#baselineKey = this.key;
	};

	// Two checkpoints: the first banks whatever was half-typed, the second the structural change.
	step = (change: () => void) => {
		this.checkpoint();
		change();
		this.checkpoint();
	};

	undo = () => {
		this.checkpoint();
		const previous = this.#past.at(-1);
		if (!previous) return;
		this.#past = this.#past.slice(0, -1);
		this.#future = [...this.#future, this.#baseline];
		this.#apply(previous);
	};

	redo = () => {
		this.checkpoint();
		const next = this.#future.at(-1);
		if (!next) return;
		this.#future = this.#future.slice(0, -1);
		this.#past = [...this.#past, this.#baseline];
		this.#apply(next);
	};

	#apply(entry: S) {
		this.#options.restore(entry);
		this.#baseline = entry;
		this.#baselineKey = this.#options.serialise();
	}
}

/** What the editor's controls use; none of them sees the state it holds. */
export type HistoryControls = Pick<
	EditHistory<unknown>,
	'canUndo' | 'canRedo' | 'undo' | 'redo' | 'step' | 'checkpoint'
>;
