import type { ErrorContext, ErrorDecision, ErrorStrategy } from './ErrorStrategy';

/** Default: the first failure stops the run; nothing is undone. */
export class FailFastStrategy implements ErrorStrategy {
  readonly name = 'fail-fast';

  handle(): ErrorDecision {
    return { action: 'abort' };
  }
}

/** Failures are ignored: the failed step is skipped and the previous value flows on. */
export class ContinueOnErrorStrategy implements ErrorStrategy {
  readonly name = 'continue-on-error';

  handle(): ErrorDecision {
    return { action: 'skip' };
  }
}

/** Saga-style: undo everything that already ran (newest first), then report the failure. */
export class RollbackOnErrorStrategy implements ErrorStrategy {
  readonly name = 'rollback-on-error';

  handle(): ErrorDecision {
    return { action: 'rollback' };
  }
}

/** Substitutes the failed step's result with a fixed value or a value computed from the failure. */
export class FallbackStrategy implements ErrorStrategy {
  readonly name = 'fallback';
  private readonly provide: (failure: ErrorContext) => unknown;

  constructor(fallback: unknown) {
    this.provide =
      typeof fallback === 'function'
        ? (fallback as (failure: ErrorContext) => unknown)
        : () => fallback;
  }

  handle(failure: ErrorContext): ErrorDecision {
    return { action: 'replace', value: this.provide(failure) };
  }
}

export const failFast = (): ErrorStrategy => new FailFastStrategy();
export const continueOnError = (): ErrorStrategy => new ContinueOnErrorStrategy();
export const rollbackOnError = (): ErrorStrategy => new RollbackOnErrorStrategy();
/** Pass a value, or a function `(failure) => value` to compute it from the failure. */
export function fallbackTo(fallback: (failure: ErrorContext) => unknown): ErrorStrategy;
export function fallbackTo(fallback: unknown): ErrorStrategy;
export function fallbackTo(fallback: unknown): ErrorStrategy {
  return new FallbackStrategy(fallback);
}
