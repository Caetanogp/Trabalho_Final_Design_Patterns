import { InMemoryAuditTrail } from '../events/observers/InMemoryAuditTrail';
import { PipelineEventBus } from '../events/PipelineEventBus';
import type { ObserverLike } from '../events/PipelineEventBus';
import { FailFastStrategy } from '../strategies/builtinStrategies';
import type { ErrorContext, ErrorDecision, ErrorStrategy } from '../strategies/ErrorStrategy';
import type { ContextMemento } from './ContextMemento';
import { PipelineHaltedError, StepExecutionError, toError } from './errors';
import { PipelineContext } from './PipelineContext';
import type { FailureResult, HaltedResult, PipelineResult, ResultBase } from './PipelineResult';
import type { AnyStep, Step } from './Step';

export interface PipelineOptions {
  readonly name?: string;
  readonly steps: readonly AnyStep[];
  readonly errorStrategy?: ErrorStrategy;
  readonly observers?: readonly ObserverLike[];
}

export interface RunOptions {
  /** Read-only data made available to every step through `ctx.metadata`. */
  readonly metadata?: Readonly<Record<string, unknown>>;
  /** Aborting the signal halts the run before the next step starts. */
  readonly signal?: AbortSignal;
}

/**
 * @pattern Composite
 *
 * A `Pipeline` IS a `Step`, so a pipeline can be placed inside another pipeline (or inside a
 * router/parallel branch) exactly like a leaf step. Clients treat one step and a whole tree of
 * steps through the same interface. All nested steps share the run's context, so a rollback in
 * an outer pipeline also undoes what the inner pipeline did.
 *
 * Build instances with `createPipeline()` / `PipelineBuilder` rather than calling `new`.
 */
export class Pipeline<TInput = unknown, TOutput = unknown> implements Step<TInput, TOutput> {
  readonly name: string;
  private readonly stepList: readonly AnyStep[];
  private readonly errorStrategy: ErrorStrategy;
  private readonly observers: readonly ObserverLike[];

  constructor(options: PipelineOptions) {
    this.name = options.name ?? 'pipeline';
    this.stepList = [...options.steps];
    this.errorStrategy = options.errorStrategy ?? new FailFastStrategy();
    this.observers = [...(options.observers ?? [])];
  }

  get steps(): readonly AnyStep[] {
    return this.stepList;
  }

  /**
   * Entry point for clients. Never throws for step failures or halts: the outcome is always a
   * `PipelineResult` that includes the audit trail of the run.
   */
  async run(input: TInput, options: RunOptions = {}): Promise<PipelineResult<TOutput>> {
    const started = performance.now();
    const audit = new InMemoryAuditTrail();
    const ctx = this.createContext(audit, options);
    // Memento: remember how the run started so a rollback can restore it.
    const initial = ctx.createMemento(input, 'initial');
    // Read only after the last event is emitted, so the audit trail is complete.
    const summary = (): ResultBase => ({
      runId: ctx.runId,
      pipeline: this.name,
      durationMs: performance.now() - started,
      audit: audit.entries,
    });

    ctx.emit({ type: 'pipeline:start', input });
    try {
      const value = (await this.runSteps(input, ctx)) as TOutput;
      ctx.emit({ type: 'pipeline:success', durationMs: performance.now() - started });
      return { status: 'success', ok: true, value, ...summary() };
    } catch (caught) {
      if (caught instanceof PipelineHaltedError) {
        return this.haltedResult(caught, input, ctx, summary);
      }
      return this.failedResult(toError(caught), input, initial, ctx, summary);
    }
  }

  /** Like `run`, but returns the value or throws (the failure, or `PipelineHaltedError`). */
  async runOrThrow(input: TInput, options: RunOptions = {}): Promise<TOutput> {
    const result = await this.run(input, options);
    if (result.status === 'success') return result.value;
    if (result.status === 'halted') throw new PipelineHaltedError(result.reason);
    throw result.error;
  }

  /**
   * `Step` contract, used when this pipeline is nested inside another one. Failures are
   * thrown (as `StepExecutionError`) so the outer pipeline's strategy can decide what to do.
   */
  async execute(input: TInput, ctx: PipelineContext): Promise<TOutput> {
    const subscriptions = this.observers.map((observer) => ctx.events.subscribe(observer));
    try {
      return (await this.runSteps(input, ctx)) as TOutput;
    } finally {
      subscriptions.forEach((unsubscribe) => unsubscribe());
    }
  }

  /** Each run gets its own bus: the audit trail and the root pipeline's observers listen to it. */
  private createContext(audit: InMemoryAuditTrail, options: RunOptions): PipelineContext {
    const events = new PipelineEventBus();
    events.subscribe(audit);
    this.observers.forEach((observer) => events.subscribe(observer));
    return new PipelineContext({
      events,
      pipelineName: this.name,
      metadata: options.metadata,
      signal: options.signal,
    });
  }

  private haltedResult(
    halted: PipelineHaltedError,
    input: unknown,
    ctx: PipelineContext,
    summary: () => ResultBase,
  ): HaltedResult {
    ctx.emit({ type: 'pipeline:halted', reason: halted.reason, step: halted.stepName });
    return {
      status: 'halted',
      ok: false,
      reason: halted.reason,
      haltedAt: halted.stepName,
      input: halted.input ?? input,
      ...summary(),
    };
  }

  private failedResult(
    error: Error,
    input: unknown,
    initial: ContextMemento,
    ctx: PipelineContext,
    summary: () => ResultBase,
  ): FailureResult {
    const failure = error instanceof StepExecutionError ? error : undefined;
    const rolledBack = failure?.rolledBack ?? false;
    ctx.emit({ type: 'pipeline:failed', error, rolledBack });
    return {
      status: 'failed',
      ok: false,
      error,
      failedStep: failure?.stepName,
      rolledBack,
      rollback: failure?.rollback,
      // Memento in action: after a rollback the shared state and the input go back to the start.
      input: rolledBack ? ctx.restore(initial) : input,
      ...summary(),
    };
  }

  private async runSteps(input: TInput, ctx: PipelineContext): Promise<unknown> {
    const mark = ctx.history.size;
    let value: unknown = input;

    for (const [index, step] of this.stepList.entries()) {
      if (ctx.isAborted) {
        throw this.markHalted(new PipelineHaltedError('aborted by signal'), step, value, ctx);
      }
      value = await this.runStep(step, value, index, ctx, mark);
    }
    return value;
  }

  /** Runs one step. Success is recorded in the history (Command); on failure the strategy decides. */
  private async runStep(
    step: AnyStep,
    input: unknown,
    index: number,
    ctx: PipelineContext,
    mark: number,
  ): Promise<unknown> {
    const started = performance.now();
    ctx.emit({ type: 'step:start', step: step.name, input });
    try {
      const output = await step.execute(input, ctx);
      ctx.history.record({ step, input, output });
      const durationMs = performance.now() - started;
      ctx.emit({ type: 'step:success', step: step.name, output, durationMs });
      return output;
    } catch (caught) {
      if (caught instanceof PipelineHaltedError) throw this.markHalted(caught, step, input, ctx);

      const failure: ErrorContext = { step, error: toError(caught), input, index, ctx };
      const durationMs = performance.now() - started;
      ctx.emit({ type: 'step:error', step: step.name, error: failure.error, durationMs });
      return this.applyDecision(await this.errorStrategy.handle(failure), failure, mark);
    }
  }

  /** Carries out what the error strategy decided: skip, use a fallback value, or fail (with rollback). */
  private async applyDecision(
    decision: ErrorDecision,
    { step, error, input, ctx }: ErrorContext,
    mark: number,
  ): Promise<unknown> {
    if (decision.action === 'skip') {
      ctx.emit({ type: 'step:skipped', step: step.name, error });
      return input;
    }
    if (decision.action === 'replace') {
      ctx.emit({ type: 'step:fallback', step: step.name, value: decision.value });
      return decision.value;
    }

    const failure =
      error instanceof StepExecutionError ? error : new StepExecutionError(step.name, error);
    if (decision.action === 'rollback') {
      failure.rollback = await ctx.history.rollbackTo(mark, ctx);
      failure.rolledBack = true;
    }
    throw failure;
  }

  /** The innermost pipeline to see a halt records where it happened; outer ones just pass it on. */
  private markHalted(
    halted: PipelineHaltedError,
    step: AnyStep,
    input: unknown,
    ctx: PipelineContext,
  ): PipelineHaltedError {
    if (halted.stepName === undefined) {
      halted.stepName = step.name;
      halted.input = input;
      ctx.emit({ type: 'step:halted', step: step.name, reason: halted.reason });
    }
    return halted;
  }
}
