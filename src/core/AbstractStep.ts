import type { PipelineContext } from './PipelineContext';
import type { Step } from './Step';

/**
 * @pattern Template Method
 *
 * Fixes the skeleton every step follows: `validateInput` → `before` → `process` → `after`.
 * Subclasses implement only `process` (the part that changes) and may override the optional
 * hooks. The skeleton itself, `execute`, is the template and is what the pipeline calls.
 *
 * ```ts
 * class SlugifyStep extends AbstractStep<string, string> {
 *   protected process(text: string) {
 *     return text.toLowerCase().replace(/\s+/g, '-');
 *   }
 * }
 * ```
 */
export abstract class AbstractStep<TInput = unknown, TOutput = unknown> implements Step<
  TInput,
  TOutput
> {
  readonly name: string;

  constructor(name?: string) {
    this.name = name ?? this.constructor.name;
  }

  /** The template method. Subclasses customise it through the hooks, never by replacing it. */
  async execute(input: TInput, ctx: PipelineContext): Promise<TOutput> {
    this.validateInput(input);
    await this.before(input, ctx);
    const output = await this.process(input, ctx);
    await this.after(output, ctx);
    return output;
  }

  /** The only mandatory part: the actual work of the step. */
  protected abstract process(input: TInput, ctx: PipelineContext): TOutput | Promise<TOutput>;

  /** Hook: throw here to reject an invalid input before any work is done. */
  protected validateInput(_input: TInput): void {}

  /** Hook: runs right before `process`. */
  protected before(_input: TInput, _ctx: PipelineContext): void | Promise<void> {}

  /** Hook: runs right after `process`, with its result. */
  protected after(_output: TOutput, _ctx: PipelineContext): void | Promise<void> {}
}
