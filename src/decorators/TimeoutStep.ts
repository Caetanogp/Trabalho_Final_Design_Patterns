import { StepTimeoutError } from '../core/errors';
import type { PipelineContext } from '../core/PipelineContext';
import type { Step } from '../core/Step';
import { StepDecorator } from './StepDecorator';

/**
 * Fails with `StepTimeoutError` when the inner step takes longer than `timeoutMs`.
 * JavaScript cannot cancel a running promise: the inner work may still finish in the background.
 */
export class TimeoutStep<TInput, TOutput> extends StepDecorator<TInput, TOutput> {
  constructor(
    inner: Step<TInput, TOutput>,
    private readonly timeoutMs: number,
  ) {
    super(inner, 'timeout');
  }

  override async execute(input: TInput, ctx: PipelineContext): Promise<TOutput> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const deadline = new Promise<never>((_, reject) => {
      timer = setTimeout(
        () => reject(new StepTimeoutError(this.inner.name, this.timeoutMs)),
        this.timeoutMs,
      );
    });
    try {
      return await Promise.race([Promise.resolve(this.inner.execute(input, ctx)), deadline]);
    } finally {
      clearTimeout(timer);
    }
  }
}
