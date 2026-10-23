import type { PipelineEvent, PipelineEventType, PipelineObserver } from '../PipelineEventBus';

/** Keeps every event it receives. `Pipeline.run` uses one to fill `result.audit`. */
export class InMemoryAuditTrail implements PipelineObserver {
  private readonly events: PipelineEvent[] = [];

  onEvent(event: PipelineEvent): void {
    this.events.push(event);
  }

  get entries(): readonly PipelineEvent[] {
    return [...this.events];
  }

  ofType<T extends PipelineEventType>(type: T): Extract<PipelineEvent, { type: T }>[] {
    return this.events.filter((e): e is Extract<PipelineEvent, { type: T }> => e.type === type);
  }

  clear(): void {
    this.events.length = 0;
  }
}
