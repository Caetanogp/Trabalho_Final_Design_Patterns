import { PipelineHaltedError, toError } from '../core/errors';
import type { PipelineContext } from '../core/PipelineContext';
import type { Step } from '../core/Step';
import { StepDecorator } from './StepDecorator';

export interface RetryOptions {
  /** Extra attempts after the first one. Default: 2. */
  readonly retries?: number;
  /** Wait before the first retry, in ms. Default: 0. */
  readonly delayMs?: number;
  /** Multiplier applied to the delay after each retry (exponential backoff). Default: 1. */
  readonly backoff?: number;
  /** Return false to give up immediately for errors that will never succeed. */
  readonly shouldRetry?: (error: Error, attempt: number) => boolean;
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Re-runs the inner step when it throws. Halts (intentional stops) are never retried. */
export class RetryStep<TInput, TOutput> extends StepDecorator<TInput, TOutput> {
  private readonly retries: number;
  private readonly delayMs: number;
  private readonly backoff: number;
  private readonly shouldRetry: (error: Error, attempt: number) => boolean;

  constructor(inner: Step<TInput, TOutput>, options: RetryOptions = {}) {
    super(inner, 'retry');
    this.retries = options.retries ?? 2;
    this.delayMs = options.delayMs ?? 0;
    this.backoff = options.backoff ?? 1;
    this.shouldRetry = options.shouldRetry ?? (() => true);
  }

  override async execute(input: TInput, ctx: PipelineContext): Promise<TOutput> {
    let delay = this.delayMs;
    for (let attempt = 1; ; attempt += 1) {
      try {
        return await this.inner.execute(input, ctx);
      } catch (caught) {
        if (caught instanceof PipelineHaltedError) throw caught;
        const error = toError(caught);
        if (attempt > this.retries || !this.shouldRetry(error, attempt)) throw error;
        ctx.emit({ type: 'step:retry', step: this.inner.name, attempt, delayMs: delay, error });
        if (delay > 0) await sleep(delay);
        delay *= this.backoff;
      }
    }
  }
}
