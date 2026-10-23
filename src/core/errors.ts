import type { RollbackReport } from './CommandHistory';

export interface ValidationIssue {
  readonly field: string;
  readonly message: string;
}

/** Base class of every error raised by pipeforge. */
export class PipelineError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = new.target.name;
  }
}

/** Raised by `ValidateStep` with every rule that failed (not only the first one). */
export class ValidationError extends PipelineError {
  constructor(readonly issues: readonly ValidationIssue[]) {
    super(`Validation failed: ${issues.map((i) => `${i.field}: ${i.message}`).join('; ')}`);
  }
}

/**
 * Control-flow signal, not a failure: a step asked the pipeline to stop on purpose
 * (see `PipelineContext.halt`). It never triggers rollback or an error strategy.
 */
export class PipelineHaltedError extends PipelineError {
  /** Filled in by the innermost pipeline that observes the halt. */
  stepName?: string;
  /** Input received by the step that halted the flow. */
  input?: unknown;

  constructor(readonly reason: string) {
    super(`Pipeline halted: ${reason}`);
  }
}

/** Wraps whatever a step threw, remembering which step failed and whether we rolled back. */
export class StepExecutionError extends PipelineError {
  rolledBack = false;
  /** What the rollback undid, when one happened. */
  rollback?: RollbackReport;

  constructor(
    readonly stepName: string,
    cause: unknown,
  ) {
    super(`Step "${stepName}" failed: ${cause instanceof Error ? cause.message : String(cause)}`, {
      cause,
    });
  }
}

export class StepTimeoutError extends PipelineError {
  constructor(
    readonly stepName: string,
    readonly timeoutMs: number,
  ) {
    super(`Step "${stepName}" exceeded the timeout of ${timeoutMs}ms`);
  }
}

export class NoRouteMatchedError extends PipelineError {
  constructor(readonly routerName: string) {
    super(`Router "${routerName}" has no route for this input and no default step`);
  }
}

export class UnknownStepTypeError extends PipelineError {
  constructor(
    readonly type: string,
    known: readonly string[],
  ) {
    super(`Unknown step type "${type}". Registered types: ${known.join(', ') || '(none)'}`);
  }
}

export class InvalidDefinitionError extends PipelineError {}

export function toError(value: unknown): Error {
  return value instanceof Error ? value : new Error(String(value));
}
