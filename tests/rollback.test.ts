import { describe, expect, it } from 'vitest';
import {
  ContextMemento,
  PipelineContext,
  PipelineEventBus,
  continueOnError,
  createPipeline,
  failFast,
  fallbackTo,
  rollbackOnError,
  type ErrorStrategy,
} from '../src';
import { loggedStep } from './helpers';

describe('Command: rollback with compensate()', () => {
  it('undoes executed steps in reverse order and restores the initial input', async () => {
    const log: string[] = [];
    const result = await createPipeline<number>()
      .add(loggedStep('a', log))
      .add(loggedStep('b', log))
      .add(loggedStep('c', log, { fail: true }))
      .onError(rollbackOnError())
      .build()
      .run(10);

    expect(log).toEqual(['do:a', 'do:b', 'undo:b', 'undo:a']);
    expect(result.status).toBe('failed');
    if (result.status === 'failed') {
      expect(result.rolledBack).toBe(true);
      expect(result.failedStep).toBe('c');
      expect(result.rollback?.compensated).toEqual(['b', 'a']);
      expect(result.input).toBe(10);
    }
    expect(result.audit.map((e) => e.type)).toContain('rollback:end');
  });

  it('skips steps that have no compensate and does not count them as undone', async () => {
    const log: string[] = [];
    const result = await createPipeline<number>()
      .add(loggedStep('a', log))
      .add(loggedStep('pure', log, { reversible: false }))
      .add(loggedStep('c', log, { fail: true }))
      .onError(rollbackOnError())
      .build()
      .run(1);

    expect(log).toEqual(['do:a', 'do:pure', 'undo:a']);
    if (result.status === 'failed') expect(result.rollback?.compensated).toEqual(['a']);
  });

  it('keeps unwinding when a compensation itself fails, and reports it', async () => {
    const log: string[] = [];
    const brokenUndo = {
      name: 'broken-undo',
      execute: (n: number) => n,
      compensate: () => {
        throw new Error('cannot undo');
      },
    };
    const result = await createPipeline<number>()
      .add(loggedStep('a', log))
      .add(brokenUndo)
      .add(loggedStep('c', log, { fail: true }))
      .onError(rollbackOnError())
      .build()
      .run(1);

    expect(log).toEqual(['do:a', 'undo:a']);
    if (result.status === 'failed') {
      expect(result.rollback?.failures).toHaveLength(1);
      expect(result.rollback?.failures[0]?.step).toBe('broken-undo');
    }
  });

  it('tap() with undo is reversible', async () => {
    const saved: string[] = [];
    const result = await createPipeline<string>()
      .tap(
        (value) => void saved.push(value),
        (value) => void saved.splice(saved.indexOf(value), 1),
        { name: 'save' },
      )
      .map(() => {
        throw new Error('later failure');
      })
      .onError(rollbackOnError())
      .build()
      .run('row-1');

    expect(saved).toEqual([]);
    expect(result.ok).toBe(false);
  });

  it('a rollback in the outer pipeline also undoes the inner pipeline', async () => {
    const log: string[] = [];
    const inner = createPipeline<number>('inner')
      .add(loggedStep('x', log))
      .add(loggedStep('y', log))
      .build();
    const result = await createPipeline<number>('outer')
      .add(inner)
      .add(loggedStep('boom', log, { fail: true }))
      .onError(rollbackOnError())
      .build()
      .run(0);

    expect(log).toEqual(['do:x', 'do:y', 'undo:y', 'undo:x']);
    expect(result.ok).toBe(false);
  });
});

describe('Memento', () => {
  it('restores the shared state and input captured before the run', () => {
    const ctx = new PipelineContext({ events: new PipelineEventBus(), pipelineName: 't' });
    ctx.set('items', [1, 2]);
    const memento = ctx.createMemento({ id: 7 }, 'before');

    ctx.set('items', [9]);
    ctx.set('extra', true);
    const input = ctx.restore(memento);

    expect(input).toEqual({ id: 7 });
    expect(ctx.get('items')).toEqual([1, 2]);
    expect(ctx.has('extra')).toBe(false);
    expect(memento.label).toBe('before');
  });

  it('is immutable and isolated from later mutations', () => {
    const original = { tags: ['a'] };
    const memento = new ContextMemento(original, new Map());

    original.tags.push('b');
    expect(memento.input.tags).toEqual(['a']);
    memento.input.tags.push('z'); // mutating a read copy does not alter the memento
    expect(memento.input.tags).toEqual(['a']);
    expect(Object.isFrozen(memento)).toBe(true);
  });

  it('keeps non-cloneable values by reference instead of failing', () => {
    const fn = () => 1;
    const memento = new ContextMemento({ fn }, new Map([['cb', fn]]));
    expect(memento.input.fn).toBe(fn);
  });
});

describe('Strategy: error policies', () => {
  const failing = (n: number): number => {
    if (n < 0) throw new Error('negative');
    return n;
  };

  it('fail-fast aborts on the first error (default) without rollback', async () => {
    const result = await createPipeline<number>()
      .map(failing)
      .map((n) => n + 1)
      .build()
      .run(-1);
    expect(result.status).toBe('failed');
    if (result.status === 'failed') expect(result.rolledBack).toBe(false);
  });

  it('failFast() can be selected explicitly', async () => {
    const result = await createPipeline<number>().map(failing).onError(failFast()).build().run(-1);
    expect(result.ok).toBe(false);
  });

  it('continue-on-error skips the failed step and keeps going', async () => {
    const result = await createPipeline<number>()
      .map(failing)
      .map((n) => n + 100)
      .onError(continueOnError())
      .build()
      .run(-1);

    expect(result.ok && result.value).toBe(99);
    expect(result.audit.map((e) => e.type)).toContain('step:skipped');
  });

  it('fallback substitutes a value (fixed or computed)', async () => {
    const fixed = await createPipeline<number>()
      .map(failing)
      .onError(fallbackTo(0))
      .build()
      .run(-1);
    expect(fixed.ok && fixed.value).toBe(0);

    const computed = await createPipeline<number>()
      .map(failing)
      .onError(fallbackTo(({ input }) => Math.abs(input as number)))
      .build()
      .run(-7);
    expect(computed.ok && computed.value).toBe(7);
    expect(computed.audit.map((e) => e.type)).toContain('step:fallback');
  });

  it('accepts a custom strategy written by the client', async () => {
    const selective: ErrorStrategy = {
      name: 'selective',
      handle: ({ error }) =>
        error instanceof TypeError ? { action: 'rollback' } : { action: 'abort' },
    };
    const result = await createPipeline<number>()
      .map(() => {
        throw new TypeError('wrong type');
      })
      .onError(selective)
      .build()
      .run(1);
    expect(result.status === 'failed' && result.rolledBack).toBe(true);
  });
});
