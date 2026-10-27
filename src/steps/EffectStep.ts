import { AbstractStep } from '../core/AbstractStep';
import type { PipelineContext } from '../core/PipelineContext';

type EffectFn<T> = (value: T, ctx: PipelineContext) => void | Promise<void>;

/**
 * A side-effect step that passes its input through unchanged (save, publish, notify, log...).
 * Give it an `undo` and it becomes a reversible Command: if a later step fails and the pipeline
 * uses `rollbackOnError()`, `undo` is called with the value that went through the step.
 */
export class EffectStep<T> extends AbstractStep<T, T> {
  /** Only present when an `undo` was given, so steps without one are not reported as undone. */
  readonly compensate?: (input: T, output: T, ctx: PipelineContext) => void | Promise<void>;

  constructor(
    private readonly effect: EffectFn<T>,
    undo?: EffectFn<T>,
    name = 'effect',
  ) {
    super(name);
    if (undo) this.compensate = (input, _output, ctx) => undo(input, ctx);
  }

  protected override async process(input: T, ctx: PipelineContext): Promise<T> {
    await this.effect(input, ctx);
    return input;
  }
}
