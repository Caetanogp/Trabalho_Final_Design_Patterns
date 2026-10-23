import { PipelineHaltedError } from './errors';
import { CommandHistory } from './CommandHistory';
import { ContextMemento, MEMENTO_STATE } from './ContextMemento';
import type {
  PipelineEvent,
  PipelineEventBus,
  PipelineEventInput,
} from '../events/PipelineEventBus';

export interface PipelineContextOptions {
  readonly events: PipelineEventBus;
  readonly pipelineName: string;
  readonly metadata?: Readonly<Record<string, unknown>>;
  readonly signal?: AbortSignal;
}

let runCounter = 0;

function nextRunId(): string {
  runCounter += 1;
  return `run-${Date.now().toString(36)}-${runCounter}`;
}

/**
 * Everything steps share during ONE run: a key/value state, read-only metadata supplied by the
 * caller, the event bus and the history of executed commands.
 *
 * It is also the Originator of the Memento pattern (`createMemento` / `restore`).
 */
export class PipelineContext {
  readonly runId = nextRunId();
  readonly startedAt = Date.now();
  readonly events: PipelineEventBus;
  readonly history = new CommandHistory();
  readonly metadata: Readonly<Record<string, unknown>>;
  readonly pipelineName: string;
  private readonly signal?: AbortSignal;
  private state = new Map<string, unknown>();

  constructor(options: PipelineContextOptions) {
    this.events = options.events;
    this.pipelineName = options.pipelineName;
    this.metadata = options.metadata ?? {};
    this.signal = options.signal;
  }

  get<T = unknown>(key: string): T | undefined {
    return this.state.get(key) as T | undefined;
  }

  set(key: string, value: unknown): this {
    this.state.set(key, value);
    return this;
  }

  has(key: string): boolean {
    return this.state.has(key);
  }

  delete(key: string): boolean {
    return this.state.delete(key);
  }

  /** Read-only copy of the shared state, handy for assertions and debugging. */
  entries(): ReadonlyMap<string, unknown> {
    return new Map(this.state);
  }

  /** Stops the pipeline on purpose (not an error). Never returns. */
  halt(reason: string): never {
    throw new PipelineHaltedError(reason);
  }

  /** True once the caller aborted the run through the `AbortSignal`. */
  get isAborted(): boolean {
    return this.signal?.aborted ?? false;
  }

  emit(event: PipelineEventInput): void {
    this.events.emit({
      ...event,
      runId: this.runId,
      timestamp: Date.now(),
      pipeline: this.pipelineName,
    } as PipelineEvent);
  }

  /** @pattern Memento (Originator): captures the input and the shared state. */
  createMemento<T>(input: T, label?: string): ContextMemento<T> {
    return new ContextMemento(input, this.state, label);
  }

  /** @pattern Memento (Originator): returns the shared state to the saved moment. */
  restore<T>(memento: ContextMemento<T>): T {
    this.state = new Map(memento[MEMENTO_STATE]());
    return memento.input;
  }
}
