import type { PipelineContext } from '../core/PipelineContext';
import type { AnyStep } from '../core/Step';

export interface ErrorContext {
  readonly step: AnyStep;
  readonly error: Error;
  /** The value that was entering the failed step. */
  readonly input: unknown;
  /** Position of the failed step inside its pipeline. */
  readonly index: number;
  readonly ctx: PipelineContext;
}

/**
 * What the pipeline must do after a step failed:
 * - `abort`: stop and report the failure, leaving effects as they are;
 * - `rollback`: compensate every executed step (newest first), then report the failure;
 * - `skip`: ignore the failure and pass the previous value to the next step;
 * - `replace`: continue with `value` as if the step had produced it.
 */
export type ErrorDecision =
  | { readonly action: 'abort' }
  | { readonly action: 'rollback' }
  | { readonly action: 'skip' }
  | { readonly action: 'replace'; readonly value: unknown };

/**
 * @pattern Strategy
 *
 * The policy for handling a failed step is a replaceable object. The pipeline executor never
 * decides by itself whether to stop, undo or carry on; it asks its strategy. Implement this
 * interface to create policies of your own (e.g. "rollback only on ValidationError").
 */
export interface ErrorStrategy {
  readonly name: string;
  handle(failure: ErrorContext): ErrorDecision | Promise<ErrorDecision>;
}
