import type { PipelineContext } from '../core/PipelineContext';
import type { Step } from '../core/Step';

export type StepFunction<TInput, TOutput> = (
  input: TInput,
  ctx: PipelineContext,
) => TOutput | Promise<TOutput>;

export type UndoFunction<TInput, TOutput> = (
  input: TInput,
  output: TOutput,
  ctx: PipelineContext,
) => void | Promise<void>;

/**
 * @pattern Adapter
 *
 * The pipeline only understands the `Step` interface, but most users just have a function.
 * The adapter makes any `(input, ctx) => output` fit that interface (and an optional `undo`
 * fit `compensate`), so `.map(fn)` and `adaptFunction(...)` need no ceremony.
 */
export class FunctionStepAdapter<TInput, TOutput> implements Step<TInput, TOutput> {
  readonly compensate?: (
    input: TInput,
    output: TOutput,
    ctx: PipelineContext,
  ) => void | Promise<void>;

  constructor(
    readonly name: string,
    private readonly fn: StepFunction<TInput, TOutput>,
    undo?: UndoFunction<TInput, TOutput>,
  ) {
    if (undo) this.compensate = undo;
  }

  execute(input: TInput, ctx: PipelineContext): TOutput | Promise<TOutput> {
    return this.fn(input, ctx);
  }
}

export function adaptFunction<TInput, TOutput>(
  name: string,
  fn: StepFunction<TInput, TOutput>,
  undo?: UndoFunction<TInput, TOutput>,
): Step<TInput, TOutput> {
  return new FunctionStepAdapter(name, fn, undo);
}

/** Accepts either a ready-made step or a plain function and always returns a `Step`. */
export function asStep<TInput, TOutput>(
  name: string,
  stepOrFn: Step<TInput, TOutput> | StepFunction<TInput, TOutput>,
): Step<TInput, TOutput> {
  return typeof stepOrFn === 'function' ? adaptFunction(name, stepOrFn) : stepOrFn;
}
