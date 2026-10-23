import { toError } from './errors';
import type { PipelineContext } from './PipelineContext';
import type { AnyStep } from './Step';

export interface HistoryEntry {
  readonly step: AnyStep;
  readonly input: unknown;
  readonly output: unknown;
}

export interface RollbackReport {
  /** Names of the steps whose `compensate` ran successfully, in the order they ran. */
  readonly compensated: readonly string[];
  readonly failures: readonly { readonly step: string; readonly error: Error }[];
}

/**
 * @pattern Command (invoker's history)
 *
 * Stack of the commands that already ran successfully. Rolling back means popping them in
 * reverse order and calling `compensate`. A compensation that throws is reported but does not
 * stop the unwinding: undoing as much as possible is better than stopping halfway.
 */
export class CommandHistory {
  private readonly entries: HistoryEntry[] = [];

  get size(): number {
    return this.entries.length;
  }

  record(entry: HistoryEntry): void {
    this.entries.push(entry);
  }

  /** Undoes (newest first) every entry recorded after `mark`, which is a previous `size`. */
  async rollbackTo(mark: number, ctx: PipelineContext): Promise<RollbackReport> {
    const undoable = this.entries.slice(mark).filter((entry) => entry.step.compensate);
    ctx.emit({ type: 'rollback:start', steps: undoable.length });

    const compensated: string[] = [];
    const failures: { step: string; error: Error }[] = [];

    while (this.entries.length > mark) {
      const entry = this.entries.pop();
      if (!entry?.step.compensate) continue;
      try {
        await entry.step.compensate(entry.input, entry.output, ctx);
        compensated.push(entry.step.name);
        ctx.emit({ type: 'rollback:step', step: entry.step.name });
      } catch (caught) {
        const error = toError(caught);
        failures.push({ step: entry.step.name, error });
        ctx.emit({ type: 'rollback:step', step: entry.step.name, error });
      }
    }

    ctx.emit({ type: 'rollback:end', compensated: compensated.length, failures: failures.length });
    return { compensated, failures };
  }
}
