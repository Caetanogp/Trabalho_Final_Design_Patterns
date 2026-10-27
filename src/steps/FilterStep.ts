import { AbstractStep } from '../core/AbstractStep';
import type { PipelineContext } from '../core/PipelineContext';

/**
 * Lets the value through when `predicate` is true; otherwise HALTS the pipeline (an intentional
 * stop, not a failure: no rollback, no error strategy, `result.status === 'halted'`).
 */
export class FilterStep<T> extends AbstractStep<T, T> {
  constructor(
    private readonly predicate: (value: T, ctx: PipelineContext) => boolean | Promise<boolean>,
    private readonly reason = 'rejected by filter',
    name = 'filter',
  ) {
    super(name);
  }

  protected override async process(input: T, ctx: PipelineContext): Promise<T> {
    if (await this.predicate(input, ctx)) return input;
    return ctx.halt(this.reason);
  }
}
