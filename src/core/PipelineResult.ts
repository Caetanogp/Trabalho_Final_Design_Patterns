import type { PipelineEvent } from '../events/PipelineEventBus';
import type { RollbackReport } from './CommandHistory';

/** Fields shared by every outcome of a run. */
export interface ResultBase {
  readonly runId: string;
  readonly pipeline: string;
  readonly durationMs: number;
  /** Every event of the run, in order: a complete audit trail. */
  readonly audit: readonly PipelineEvent[];
}

export interface SuccessResult<TOutput> extends ResultBase {
  readonly status: 'success';
  readonly ok: true;
  readonly value: TOutput;
}

export interface FailureResult extends ResultBase {
  readonly status: 'failed';
  readonly ok: false;
  readonly error: Error;
  readonly failedStep?: string;
  readonly rolledBack: boolean;
  readonly rollback?: RollbackReport;
  /** Input restored from the Memento when a rollback happened; otherwise the original input. */
  readonly input: unknown;
}

export interface HaltedResult extends ResultBase {
  readonly status: 'halted';
  readonly ok: false;
  readonly reason: string;
  readonly haltedAt?: string;
  /** The value that reached the step that halted the flow. */
  readonly input: unknown;
}

/** Discriminate on `status` (or `ok`) to get a fully typed outcome. */
export type PipelineResult<TOutput = unknown> =
  SuccessResult<TOutput> | FailureResult | HaltedResult;
