import type { PipelineEvent, PipelineObserver } from '../PipelineEventBus';

export type LogFn = (line: string) => void;

/** Default one-line rendering of an event. */
export function formatEvent(event: PipelineEvent): string {
  const head = `[${event.pipeline}#${event.runId}] ${event.type}`;
  switch (event.type) {
    case 'step:start':
    case 'rollback:step':
      return `${head} ${event.step}`;
    case 'step:success':
      return `${head} ${event.step} (${event.durationMs.toFixed(1)}ms)`;
    case 'step:error':
    case 'step:skipped':
      return `${head} ${event.step}: ${event.error.message}`;
    case 'step:retry':
      return `${head} ${event.step} attempt=${event.attempt} in ${event.delayMs}ms: ${event.error.message}`;
    case 'step:halted':
      return `${head} ${event.step}: ${event.reason}`;
    case 'pipeline:halted':
      return `${head}: ${event.reason}`;
    case 'pipeline:failed':
      return `${head}: ${event.error.message} (rolledBack=${event.rolledBack})`;
    case 'rollback:end':
      return `${head} compensated=${event.compensated} failures=${event.failures}`;
    default:
      return head;
  }
}

/** Prints every event as one line. Pass your own `log` (e.g. a logger) to redirect the output. */
export class ConsoleAuditObserver implements PipelineObserver {
  constructor(
    private readonly log: LogFn = (line) => console.log(line),
    private readonly format: (event: PipelineEvent) => string = formatEvent,
  ) {}

  onEvent(event: PipelineEvent): void {
    this.log(this.format(event));
  }
}
