import { describe, expect, it, vi } from 'vitest';
import {
  ConsoleAuditObserver,
  InMemoryAuditTrail,
  MetricsObserver,
  PipelineEventBus,
  continueOnError,
  createPipeline,
  formatEvent,
  rollbackOnError,
  type PipelineEvent,
  type PipelineObserver,
} from '../src';
import { loggedStep } from './helpers';

describe('Observer: PipelineEventBus', () => {
  const event = {
    type: 'pipeline:start',
    input: 1,
    runId: 'r',
    timestamp: 0,
    pipeline: 'p',
  } as const;

  it('notifies observers and functions, and supports unsubscribing', () => {
    const bus = new PipelineEventBus();
    const received: string[] = [];
    const unsubscribe = bus.subscribe((e) => void received.push(`fn:${e.type}`));
    bus.subscribe({ onEvent: (e) => void received.push(`obj:${e.type}`) });
    expect(bus.size).toBe(2);

    bus.emit(event);
    unsubscribe();
    bus.emit(event);

    expect(received).toEqual(['fn:pipeline:start', 'obj:pipeline:start', 'obj:pipeline:start']);
  });

  it('isolates failing observers (sync and async) from the run', async () => {
    const errors: unknown[] = [];
    const bus = new PipelineEventBus((e) => errors.push(e));
    bus.subscribe(() => {
      throw new Error('sync fail');
    });
    bus.subscribe(async () => {
      throw new Error('async fail');
    });
    const healthy = vi.fn();
    bus.subscribe(healthy);

    bus.emit(event);
    await Promise.resolve();
    await Promise.resolve();

    expect(healthy).toHaveBeenCalledOnce();
    expect(errors).toHaveLength(2);
  });

  it('ignores observer errors silently by default', () => {
    const bus = new PipelineEventBus();
    bus.subscribe(() => {
      throw new Error('ignored');
    });
    expect(() => bus.emit(event)).not.toThrow();
  });

  it('a broken observer does not break a pipeline run', async () => {
    const result = await createPipeline<number>()
      .observe(() => {
        throw new Error('observer exploded');
      })
      .map((n) => n + 1)
      .build()
      .run(1);
    expect(result.ok && result.value).toBe(2);
  });
});

describe('built-in observers', () => {
  it('InMemoryAuditTrail keeps events and filters by type', async () => {
    const trail = new InMemoryAuditTrail();
    await createPipeline<number>()
      .observe(trail)
      .map((n) => n + 1)
      .build()
      .run(1);

    expect(trail.entries.map((e) => e.type)).toContain('pipeline:success');
    expect(trail.ofType('step:success')).toHaveLength(1);
    trail.clear();
    expect(trail.entries).toEqual([]);
  });

  it('ConsoleAuditObserver prints one line per event through the given logger', async () => {
    const lines: string[] = [];
    await createPipeline<number>('demo')
      .observe(new ConsoleAuditObserver((line) => void lines.push(line)))
      .map((n) => n + 1, { name: 'inc' })
      .build()
      .run(1);

    expect(lines[0]).toMatch(/^\[demo#run-.+\] pipeline:start$/);
    expect(lines.some((l) => l.includes('step:success inc'))).toBe(true);
  });

  it('ConsoleAuditObserver supports a custom formatter and defaults to console.log', () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    new ConsoleAuditObserver(undefined, () => 'custom').onEvent({
      type: 'pipeline:success',
      durationMs: 1,
      runId: 'r',
      timestamp: 0,
      pipeline: 'p',
    });
    expect(spy).toHaveBeenCalledWith('custom');
    spy.mockRestore();
  });

  it('formatEvent describes every kind of event', async () => {
    const log: string[] = [];
    const events: PipelineEvent[] = [];
    await createPipeline<number>('all')
      .observe((e) => void events.push(e))
      .add(loggedStep('ok', log))
      .add(loggedStep('bad', log, { fail: true }), { retry: 1 })
      .onError(rollbackOnError())
      .build()
      .run(1);
    await createPipeline<number>('skip')
      .observe((e) => void events.push(e))
      .map(() => {
        throw new Error('x');
      })
      .onError(continueOnError())
      .build()
      .run(1);
    await createPipeline<number>('halt')
      .observe((e) => void events.push(e))
      .filter(() => false, 'nope')
      .build()
      .run(1);

    const types = new Set(events.map((e) => e.type));
    for (const type of [
      'step:retry',
      'rollback:start',
      'rollback:step',
      'rollback:end',
      'pipeline:failed',
      'step:skipped',
      'step:halted',
      'pipeline:halted',
    ]) {
      expect(types.has(type as never), type).toBe(true);
    }
    for (const e of events) expect(formatEvent(e)).toContain(e.type);
  });

  it('MetricsObserver aggregates counters and timings across runs', async () => {
    const metrics = new MetricsObserver();
    const pipeline = createPipeline<number>('m')
      .observe(metrics)
      .map(
        (n) => {
          if (n < 0) throw new Error('neg');
          return n;
        },
        { name: 'check' },
      )
      .build();

    await pipeline.run(1);
    await pipeline.run(2);
    await pipeline.run(-1);
    await createPipeline<number>()
      .observe(metrics)
      .filter(() => false)
      .build()
      .run(1);
    await createPipeline<number>()
      .observe(metrics)
      .map(() => {
        throw new Error('r');
      })
      .onError(rollbackOnError())
      .build()
      .run(1);

    const snapshot = metrics.snapshot();
    expect(snapshot.pipelinesStarted).toBe(5);
    expect(snapshot.pipelinesSucceeded).toBe(2);
    expect(snapshot.pipelinesFailed).toBe(2);
    expect(snapshot.pipelinesHalted).toBe(1);
    expect(snapshot.rollbacks).toBe(1);
    expect(snapshot.steps.check?.runs).toBe(2);
    expect(snapshot.steps.check?.failures).toBe(1);
    expect(snapshot.steps.check?.averageMs).toBeGreaterThanOrEqual(0);
  });

  it('observers on a nested pipeline are active only while it runs', async () => {
    const innerEvents: string[] = [];
    const inner = createPipeline<number>('inner')
      .observe((e) => void innerEvents.push(e.type))
      .map((n) => n + 1)
      .build();
    const outer = createPipeline<number>('outer')
      .map((n) => n)
      .add(inner)
      .map((n) => n)
      .build();
    await outer.run(1);

    // the inner observer only sees what happens while the inner pipeline executes
    expect(innerEvents.filter((t) => t === 'step:start')).toHaveLength(1); // its own step
    expect(innerEvents).not.toContain('pipeline:start');
  });

  it('accepts a class-based observer written by the client', async () => {
    class CountingObserver implements PipelineObserver {
      count = 0;
      onEvent(): void {
        this.count += 1;
      }
    }
    const observer = new CountingObserver();
    await createPipeline<number>()
      .observe(observer)
      .map((n) => n)
      .build()
      .run(1);
    expect(observer.count).toBeGreaterThan(0);
  });
});
