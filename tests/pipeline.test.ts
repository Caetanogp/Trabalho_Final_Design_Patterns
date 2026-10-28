import { describe, expect, it } from 'vitest';
import {
  Pipeline,
  PipelineContext,
  PipelineEventBus,
  PipelineHaltedError,
  StepExecutionError,
  createPipeline,
} from '../src';
import { double } from './helpers';

describe('Pipeline.run', () => {
  it('runs steps in order and returns a typed success result', async () => {
    const result = await createPipeline<number>('math')
      .map((n) => n + 1)
      .map((n) => n * 10)
      .build()
      .run(2);

    expect(result.status).toBe('success');
    if (result.status === 'success') expect(result.value).toBe(30);
    expect(result.pipeline).toBe('math');
    expect(result.runId).toMatch(/^run-/);
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
  });

  it('records a complete audit trail in the result', async () => {
    const result = await createPipeline<number>()
      .map((n) => n + 1, { name: 'inc' })
      .build()
      .run(1);
    expect(result.audit.map((e) => e.type)).toEqual([
      'pipeline:start',
      'step:start',
      'step:success',
      'pipeline:success',
    ]);
  });

  it('returns a failed result instead of throwing, naming the failing step', async () => {
    const result = await createPipeline<number>()
      .map(
        () => {
          throw new Error('boom');
        },
        { name: 'explode' },
      )
      .build()
      .run(1);

    expect(result.status).toBe('failed');
    if (result.status === 'failed') {
      expect(result.failedStep).toBe('explode');
      expect(result.error).toBeInstanceOf(StepExecutionError);
      expect((result.error as StepExecutionError).cause).toEqual(new Error('boom'));
      expect(result.rolledBack).toBe(false);
      expect(result.input).toBe(1);
    }
  });

  it('wraps non-Error throwables', async () => {
    const result = await createPipeline<number>()
      .map(() => {
        throw 'plain string';
      })
      .build()
      .run(1);
    expect(result.status).toBe('failed');
    if (result.status === 'failed') expect(result.error.message).toContain('plain string');
  });

  it('exposes metadata and shared state to steps', async () => {
    const result = await createPipeline<number>()
      .map((n, ctx) => {
        ctx.set('seen', n);
        return n + (ctx.metadata.bonus as number);
      })
      .map((n, ctx) => `${n}:${ctx.get<number>('seen')}`)
      .build()
      .run(1, { metadata: { bonus: 10 } });

    expect(result.ok && result.value).toBe('11:1');
  });

  it('halts before the next step when the AbortSignal is aborted', async () => {
    const controller = new AbortController();
    const result = await createPipeline<number>()
      .map((n) => {
        controller.abort();
        return n;
      })
      .map((n) => n + 1, { name: 'never' })
      .build()
      .run(1, { signal: controller.signal });

    expect(result.status).toBe('halted');
    if (result.status === 'halted') {
      expect(result.reason).toMatch(/aborted/);
      expect(result.haltedAt).toBe('never');
    }
  });

  it('runOrThrow returns the value or throws', async () => {
    const ok = createPipeline<number>()
      .map((n) => n + 1)
      .build();
    await expect(ok.runOrThrow(1)).resolves.toBe(2);

    const failing = createPipeline<number>()
      .map(() => {
        throw new Error('nope');
      })
      .build();
    await expect(failing.runOrThrow(1)).rejects.toBeInstanceOf(StepExecutionError);

    const halting = createPipeline<number>()
      .filter(() => false, 'blocked')
      .build();
    await expect(halting.runOrThrow(1)).rejects.toBeInstanceOf(PipelineHaltedError);
  });

  it('keeps run state isolated between concurrent runs', async () => {
    const pipeline = createPipeline<number>()
      .map(async (n, ctx) => {
        ctx.set('n', n);
        await new Promise((resolve) => setTimeout(resolve, n === 1 ? 20 : 1));
        return ctx.get<number>('n');
      })
      .build();
    const [a, b] = await Promise.all([pipeline.run(1), pipeline.run(2)]);
    expect(a.ok && a.value).toBe(1);
    expect(b.ok && b.value).toBe(2);
    expect(a.runId).not.toBe(b.runId);
  });
});

describe('PipelineContext', () => {
  it('stores, reads and deletes shared state', () => {
    const ctx = new PipelineContext({ events: new PipelineEventBus(), pipelineName: 't' });
    ctx.set('a', 1).set('b', 2);
    expect(ctx.get('a')).toBe(1);
    expect(ctx.has('b')).toBe(true);
    expect(ctx.delete('b')).toBe(true);
    expect(ctx.has('b')).toBe(false);
    expect([...ctx.entries().keys()]).toEqual(['a']);
  });

  it('halt() throws a PipelineHaltedError carrying the reason', () => {
    const ctx = new PipelineContext({ events: new PipelineEventBus(), pipelineName: 't' });
    expect(() => ctx.halt('stop')).toThrow(PipelineHaltedError);
    expect(() => ctx.halt('stop')).toThrow('Pipeline halted: stop');
  });
});

describe('Composite: a Pipeline is a Step', () => {
  it('can be nested inside another pipeline', async () => {
    const inner = createPipeline<number>('inner')
      .map((n) => n + 1)
      .map((n) => n * 2)
      .build();
    const outer = createPipeline<number>('outer').add(inner).add(double).build();

    const result = await outer.run(1);
    expect(result.ok && result.value).toBe(8);
    const started = result.audit.filter((e) => e.type === 'step:start').length;
    expect(started).toBe(4); // inner (1) + its 2 steps + double
  });

  it('propagates a nested failure to the outer pipeline', async () => {
    const inner = createPipeline<number>('inner')
      .map(
        () => {
          throw new Error('inner broke');
        },
        { name: 'bad' },
      )
      .build();
    const result = await createPipeline<number>('outer').add(inner).build().run(1);

    expect(result.status).toBe('failed');
    if (result.status === 'failed') expect(result.failedStep).toBe('bad');
  });

  it('propagates a nested halt to the outer pipeline', async () => {
    const inner = createPipeline<number>('inner')
      .filter(() => false, 'inner says no')
      .build();
    const result = await createPipeline<number>('outer').add(inner).build().run(1);
    expect(result.status).toBe('halted');
    if (result.status === 'halted') expect(result.reason).toBe('inner says no');
  });

  it('exposes its steps and a default name', () => {
    const pipeline = new Pipeline({ steps: [double] });
    expect(pipeline.steps).toHaveLength(1);
    expect(pipeline.name).toBe('pipeline');
  });
});
