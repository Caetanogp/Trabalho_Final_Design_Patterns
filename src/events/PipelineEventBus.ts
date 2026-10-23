/** Fields shared by every event of a run. */
interface EventBase {
  readonly runId: string;
  readonly timestamp: number;
  readonly pipeline: string;
}

export type PipelineEvent =
  | (EventBase & { type: 'pipeline:start'; input: unknown })
  | (EventBase & { type: 'pipeline:success'; durationMs: number })
  | (EventBase & { type: 'pipeline:failed'; error: Error; rolledBack: boolean })
  | (EventBase & { type: 'pipeline:halted'; reason: string; step?: string })
  | (EventBase & { type: 'step:start'; step: string; input: unknown })
  | (EventBase & { type: 'step:success'; step: string; output: unknown; durationMs: number })
  | (EventBase & { type: 'step:error'; step: string; error: Error; durationMs: number })
  | (EventBase & { type: 'step:skipped'; step: string; error: Error })
  | (EventBase & { type: 'step:fallback'; step: string; value: unknown })
  | (EventBase & { type: 'step:halted'; step: string; reason: string })
  | (EventBase & {
      type: 'step:retry';
      step: string;
      attempt: number;
      delayMs: number;
      error: Error;
    })
  | (EventBase & { type: 'rollback:start'; steps: number })
  | (EventBase & { type: 'rollback:step'; step: string; error?: Error })
  | (EventBase & { type: 'rollback:end'; compensated: number; failures: number });

export type PipelineEventType = PipelineEvent['type'];

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;

/** What emitters provide; `runId`/`timestamp`/`pipeline` are stamped by the context. */
export type PipelineEventInput = DistributiveOmit<
  PipelineEvent,
  'runId' | 'timestamp' | 'pipeline'
>;

/**
 * Observer role of the Observer pattern. Implement it (or just pass a function)
 * to be told about everything that happens during a run.
 */
export interface PipelineObserver {
  onEvent(event: PipelineEvent): void | Promise<void>;
}

export type ObserverLike = PipelineObserver | ((event: PipelineEvent) => void | Promise<void>);

/**
 * @pattern Observer (Subject)
 *
 * The pipeline executor only knows how to `emit` events; auditing, logging, metrics or
 * alerting live in observers that are plugged in from the outside. A misbehaving observer
 * can never break a run: its errors are swallowed (and reported to `onObserverError`).
 */
export class PipelineEventBus {
  private readonly observers = new Set<PipelineObserver>();

  constructor(private readonly onObserverError: (error: unknown) => void = () => undefined) {}

  /** Registers an observer and returns the function that unregisters it. */
  subscribe(observer: ObserverLike): () => void {
    const normalized: PipelineObserver =
      typeof observer === 'function' ? { onEvent: observer } : observer;
    this.observers.add(normalized);
    return () => {
      this.observers.delete(normalized);
    };
  }

  emit(event: PipelineEvent): void {
    for (const observer of [...this.observers]) {
      try {
        const pending = observer.onEvent(event);
        if (pending) pending.catch(this.onObserverError);
      } catch (error) {
        this.onObserverError(error);
      }
    }
  }

  get size(): number {
    return this.observers.size;
  }
}
