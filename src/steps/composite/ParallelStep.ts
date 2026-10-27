import { PipelineHaltedError, toError } from '../../core/errors';
import type { PipelineContext } from '../../core/PipelineContext';
import type { AnyStep, Step } from '../../core/Step';
import { asBranch } from './RouterStep';

/**
 * Runs several branches at the same time on the same input and gathers their results in an
 * object keyed by branch name. When any branch fails, the others are allowed to finish first
 * (so the rollback history is complete), then the failure is raised. Branches must not mutate
 * the shared input.
 */
export class ParallelStep<TInput, TOutput = Record<string, unknown>> implements Step<
  TInput,
  TOutput
> {
  private readonly branches: readonly [string, Step<TInput, unknown>][];

  constructor(
    readonly name: string,
    branches: Readonly<Record<string, AnyStep>>,
    private readonly merge: (results: Record<string, unknown>) => TOutput = (results) =>
      results as TOutput,
  ) {
    this.branches = Object.entries(branches).map(([key, step]) => [key, asBranch(step)]);
  }

  async execute(input: TInput, ctx: PipelineContext): Promise<TOutput> {
    const settled = await Promise.allSettled(
      this.branches.map(([, branch]) => branch.execute(input, ctx)),
    );

    const failures = settled.filter((s): s is PromiseRejectedResult => s.status === 'rejected');
    const halted = failures.find((f) => f.reason instanceof PipelineHaltedError);
    if (halted) throw halted.reason;
    if (failures[0]) throw toError(failures[0].reason);

    const results: Record<string, unknown> = {};
    this.branches.forEach(([key], index) => {
      results[key] = (settled[index] as PromiseFulfilledResult<unknown>).value;
    });
    return this.merge(results);
  }
}
