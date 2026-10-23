/**
 * Clones a value when the runtime can (`structuredClone`), otherwise keeps the reference.
 * Functions, class instances with private slots, etc. cannot be cloned and are kept as-is.
 */
export function safeClone<T>(value: T): T {
  try {
    return structuredClone(value);
  } catch {
    return value;
  }
}

/**
 * Key that only the originator (`PipelineContext`) knows. It is deliberately NOT exported from
 * `index.ts`, so a caretaker holding a memento cannot peek into or tamper with the saved state.
 * @internal
 */
export const MEMENTO_STATE = Symbol('pipeforge.memento.state');

/**
 * @pattern Memento
 *
 * Opaque, immutable snapshot of a run: the original input plus the shared state of the
 * `PipelineContext` (the Originator). The pipeline (Caretaker) stores it before the first step
 * and, if a failure triggers a rollback, hands it back to the context to restore the state
 * without ever knowing how that state is organised internally.
 */
export class ContextMemento<TInput = unknown> {
  readonly createdAt = Date.now();
  private readonly savedInput: TInput;
  private readonly savedState: ReadonlyMap<string, unknown>;

  constructor(
    input: TInput,
    state: ReadonlyMap<string, unknown>,
    readonly label = 'snapshot',
  ) {
    this.savedInput = safeClone(input);
    this.savedState = new Map([...state].map(([key, value]) => [key, safeClone(value)]));
    Object.freeze(this);
  }

  /** The input the run started with (a fresh copy on every access). */
  get input(): TInput {
    return safeClone(this.savedInput);
  }

  /** @internal Only the originator reads the saved state. */
  [MEMENTO_STATE](): ReadonlyMap<string, unknown> {
    return new Map([...this.savedState].map(([key, value]) => [key, safeClone(value)]));
  }
}
