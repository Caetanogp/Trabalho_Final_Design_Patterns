import type { PipelineContext } from '../core/PipelineContext';
import type { Step } from '../core/Step';

/**
 * @pattern Decorator
 *
 * Wraps a step and implements the same `Step` interface, so a decorated step can go anywhere a
 * plain one can, and decorators can be stacked (`retry(timeout(step))`). Cross-cutting
 * behaviour (retry, timeout, timing, caching, circuit breaking...) is added around ANY step
 * without subclassing it and without the step knowing.
 *
 * Extend this class to write your own decorator and override `execute`.
 */
export abstract class StepDecorator<TInput = unknown, TOutput = unknown> implements Step<
  TInput,
  TOutput
> {
  readonly name: string;

  constructor(
    protected readonly inner: Step<TInput, TOutput>,
    label: string,
  ) {
    this.name = `${label}(${inner.name})`;
  }

  execute(input: TInput, ctx: PipelineContext): TOutput | Promise<TOutput> {
    return this.inner.execute(input, ctx);
  }

  /** Undoing a decorated step means undoing the step inside (if it can be undone at all). */
  get compensate(): Step<TInput, TOutput>['compensate'] {
    const undo = this.inner.compensate;
    return undo ? undo.bind(this.inner) : undefined;
  }
}
