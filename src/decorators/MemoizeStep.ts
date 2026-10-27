import type { PipelineContext } from '../core/PipelineContext';
import type { Step } from '../core/Step';
import { StepDecorator } from './StepDecorator';

export interface MemoizeOptions<TInput> {
  /** Cache key for an input. Default: `JSON.stringify`. */
  readonly keyOf?: (input: TInput) => string;
  /** Entries older than this are recomputed. Default: never expire. */
  readonly ttlMs?: number;
}

/**
 * Caches results per input, so repeated inputs skip the inner step. Meant for pure steps
 * (lookups, parsing...), so it is never compensated: nothing was executed on a cache hit.
 */
export class MemoizeStep<TInput, TOutput> extends StepDecorator<TInput, TOutput> {
  private readonly cache = new Map<string, { value: TOutput; storedAt: number }>();
  private readonly keyOf: (input: TInput) => string;
  private readonly ttlMs?: number;

  constructor(inner: Step<TInput, TOutput>, options: MemoizeOptions<TInput> = {}) {
    super(inner, 'memoize');
    this.keyOf = options.keyOf ?? ((input) => JSON.stringify(input));
    this.ttlMs = options.ttlMs;
  }

  override async execute(input: TInput, ctx: PipelineContext): Promise<TOutput> {
    const key = this.keyOf(input);
    const hit = this.cache.get(key);
    if (hit && (this.ttlMs === undefined || Date.now() - hit.storedAt < this.ttlMs)) {
      return hit.value;
    }
    const value = await this.inner.execute(input, ctx);
    this.cache.set(key, { value, storedAt: Date.now() });
    return value;
  }

  override get compensate(): Step<TInput, TOutput>['compensate'] {
    return undefined;
  }

  clear(): void {
    this.cache.clear();
  }
}
