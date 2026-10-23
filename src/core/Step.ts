import type { PipelineContext } from './PipelineContext';

/**
 * @pattern Command
 *
 * A step is a command object: `execute` performs the work and `compensate` knows how to undo
 * its side effects. Because every executed step is recorded in the `CommandHistory`, the
 * pipeline can unwind a failed run in reverse order without knowing what any step does.
 *
 * Only `name` and `execute` are required; `compensate` is for steps with external effects
 * (saving a record, charging a card...). Pure transformations simply omit it.
 */
export interface Step<TInput = unknown, TOutput = unknown> {
  readonly name: string;
  execute(input: TInput, ctx: PipelineContext): TOutput | Promise<TOutput>;
  /** Undoes the effects of a successful `execute`. Receives what the step saw and produced. */
  compensate?(input: TInput, output: TOutput, ctx: PipelineContext): void | Promise<void>;
}

/** A step whose input/output types are not tracked (used for heterogeneous step lists). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AnyStep = Step<any, any>;

export type StepInput<S> = S extends Step<infer I, unknown> ? I : never;
export type StepOutput<S> = S extends Step<never, infer O> ? O : never;
