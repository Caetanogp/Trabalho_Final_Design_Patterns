import type { PipelineContext } from '../core/PipelineContext';
import type { Step } from '../core/Step';
import { StepDecorator } from './StepDecorator';

/** Key under which timings are stored in the context: `ctx.get<number>(timingKey('stepName'))`. */
export const timingKey = (stepName: string): string => `timing:${stepName}`;

/** Measures how long the inner step takes (even when it fails) and stores it in the context. */
export class TimingStep<TInput, TOutput> extends StepDecorator<TInput, TOutput> {
  constructor(
    inner: Step<TInput, TOutput>,
    private readonly onTiming?: (stepName: string, durationMs: number) => void,
  ) {
    super(inner, 'timing');
  }

  override async execute(input: TInput, ctx: PipelineContext): Promise<TOutput> {
    const started = performance.now();
    try {
      return await this.inner.execute(input, ctx);
    } finally {
      const durationMs = performance.now() - started;
      ctx.set(timingKey(this.inner.name), durationMs);
      this.onTiming?.(this.inner.name, durationMs);
    }
  }
}
