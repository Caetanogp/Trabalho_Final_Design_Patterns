import type { PipelineEvent, PipelineEventType, PipelineObserver } from '../PipelineEventBus';

export interface StepMetrics {
  readonly runs: number;
  readonly failures: number;
  readonly retries: number;
  readonly totalMs: number;
  readonly averageMs: number;
}

export interface MetricsSnapshot {
  readonly pipelinesStarted: number;
  readonly pipelinesSucceeded: number;
  readonly pipelinesFailed: number;
  readonly pipelinesHalted: number;
  readonly rollbacks: number;
  readonly steps: Readonly<Record<string, StepMetrics>>;
}

interface MutableStepMetrics {
  runs: number;
  failures: number;
  retries: number;
  totalMs: number;
}

/** Aggregates counters and timings per step across any number of runs. */
export class MetricsObserver implements PipelineObserver {
  /** How many times each kind of event happened (pipeline totals are read from here). */
  private readonly eventCounts = new Map<PipelineEventType, number>();
  private readonly steps = new Map<string, MutableStepMetrics>();

  onEvent(event: PipelineEvent): void {
    this.eventCounts.set(event.type, this.count(event.type) + 1);

    if (event.type === 'step:success') {
      const metrics = this.forStep(event.step);
      metrics.runs += 1;
      metrics.totalMs += event.durationMs;
    } else if (event.type === 'step:error') {
      this.forStep(event.step).failures += 1;
    } else if (event.type === 'step:retry') {
      this.forStep(event.step).retries += 1;
    }
  }

  snapshot(): MetricsSnapshot {
    const steps: Record<string, StepMetrics> = {};
    for (const [name, metrics] of this.steps) {
      steps[name] = {
        ...metrics,
        averageMs: metrics.runs === 0 ? 0 : metrics.totalMs / metrics.runs,
      };
    }
    return {
      pipelinesStarted: this.count('pipeline:start'),
      pipelinesSucceeded: this.count('pipeline:success'),
      pipelinesFailed: this.count('pipeline:failed'),
      pipelinesHalted: this.count('pipeline:halted'),
      rollbacks: this.count('rollback:end'),
      steps,
    };
  }

  private count(type: PipelineEventType): number {
    return this.eventCounts.get(type) ?? 0;
  }

  private forStep(name: string): MutableStepMetrics {
    let metrics = this.steps.get(name);
    if (!metrics) {
      metrics = { runs: 0, failures: 0, retries: 0, totalMs: 0 };
      this.steps.set(name, metrics);
    }
    return metrics;
  }
}
