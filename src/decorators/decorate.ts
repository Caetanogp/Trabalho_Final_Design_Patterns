import type { Step } from '../core/Step';
import { MemoizeStep } from './MemoizeStep';
import type { MemoizeOptions } from './MemoizeStep';
import { RetryStep } from './RetryStep';
import type { RetryOptions } from './RetryStep';
import { TimeoutStep } from './TimeoutStep';
import { TimingStep } from './TimingStep';

/** Declarative way to stack the built-in decorators; used by the builder and the registry. */
export interface StepOptions {
  /** A number means "this many retries"; an object gives full control. */
  readonly retry?: number | RetryOptions;
  readonly timeoutMs?: number;
  readonly timing?: boolean;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  readonly memoize?: boolean | MemoizeOptions<any>;
}

/**
 * Applies the requested decorators from the inside out:
 * step → timeout (per attempt) → retry → timing (whole call) → memoize.
 */
export function decorate<TInput, TOutput>(
  step: Step<TInput, TOutput>,
  options: StepOptions = {},
): Step<TInput, TOutput> {
  let result = step;
  if (options.timeoutMs !== undefined) result = new TimeoutStep(result, options.timeoutMs);
  if (options.retry !== undefined) {
    result = new RetryStep(
      result,
      typeof options.retry === 'number' ? { retries: options.retry } : options.retry,
    );
  }
  if (options.timing) result = new TimingStep(result);
  if (options.memoize) {
    result = new MemoizeStep(
      result,
      typeof options.memoize === 'object' ? (options.memoize as MemoizeOptions<TInput>) : {},
    );
  }
  return result;
}
