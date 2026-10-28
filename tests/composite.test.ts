import { describe, expect, it } from 'vitest';
import {
  NoRouteMatchedError,
  ParallelStep,
  RouterStep,
  createPipeline,
  rollbackOnError,
  type Step,
} from '../src';
import { loggedStep } from './helpers';

const tag = (label: string): Step<number, string> => ({
  name: label,
  execute: (n) => `${label}:${n}`,
});

describe('Chain of Responsibility: RouterStep', () => {
  const routes = [
    { name: 'small', when: (n: number) => n < 10, step: tag('small') },
    { name: 'medium', when: (n: number) => n < 100, step: tag('medium') },
  ];

  it('sends the input to the first route that accepts it', async () => {
    const pipeline = createPipeline<number>().route(routes, tag('large')).build();
    expect((await pipeline.run(5)).ok && 'small:5').toBe('small:5');

    const values = await Promise.all([5, 50, 500].map((n) => pipeline.run(n)));
    expect(values.map((r) => r.ok && r.value)).toEqual(['small:5', 'medium:50', 'large:500']);
  });

  it('records the chosen route in the context', async () => {
    const result = await createPipeline<number>()
      .route(routes, undefined, { name: 'size' })
      .tap((_n, ctx) => {
        expect(ctx.get('route:size')).toBe('medium');
      })
      .build()
      .run(50);
    expect(result.ok).toBe(true);
  });

  it('fails with NoRouteMatchedError when nothing matches and there is no default', async () => {
    const result = await createPipeline<number>().route(routes).build().run(500);
    expect(result.status).toBe('failed');
    if (result.status === 'failed') {
      expect((result.error as { cause?: unknown }).cause).toBeInstanceOf(NoRouteMatchedError);
    }
  });

  it('a router without routes fails clearly', async () => {
    const result = await createPipeline<number>().add(new RouterStep('empty', [])).build().run(1);
    expect(result.ok).toBe(false);
  });

  it('routes can run whole sub-pipelines (Composite) and support async conditions', async () => {
    const vip = createPipeline<number>('vip')
      .map((n) => n * 100)
      .build();
    const pipeline = createPipeline<number>()
      .route([{ name: 'vip', when: async (n) => n === 7, step: vip }], {
        name: 'regular',
        execute: (n: number) => n,
      })
      .build();
    expect((await pipeline.run(7)).ok && (await pipeline.run(7))).toMatchObject({ value: 700 });
    expect((await pipeline.run(8)).ok && (await pipeline.run(8))).toMatchObject({ value: 8 });
  });

  it('routed steps are audited and reversible', async () => {
    const log: string[] = [];
    const result = await createPipeline<number>()
      .route([{ name: 'always', when: () => true, step: loggedStep('routed', log) }])
      .add(loggedStep('boom', log, { fail: true }))
      .onError(rollbackOnError())
      .build()
      .run(1);

    expect(log).toEqual(['do:routed', 'undo:routed']);
    expect(result.audit.some((e) => e.type === 'step:success' && e.step === 'routed')).toBe(true);
  });

  it('a halt inside a route halts the whole pipeline', async () => {
    const result = await createPipeline<number>()
      .route([
        {
          name: 'blocked',
          when: () => true,
          step: createPipeline<number>()
            .filter(() => false, 'blocked here')
            .build(),
        },
      ])
      .build()
      .run(1);
    expect(result.status).toBe('halted');
  });
});

describe('ParallelStep', () => {
  const slow = (name: string, ms: number, value: number): Step<number, number> => ({
    name,
    execute: () => new Promise((resolve) => setTimeout(() => resolve(value), ms)),
  });

  it('runs branches concurrently and keys results by branch name', async () => {
    const started = Date.now();
    const result = await createPipeline<number>()
      .parallel({ a: slow('a', 40, 1), b: slow('b', 40, 2), c: slow('c', 40, 3) })
      .build()
      .run(0);

    expect(result.ok && result.value).toEqual({ a: 1, b: 2, c: 3 });
    expect(Date.now() - started).toBeLessThan(110); // ~40ms, not 120ms
  });

  it('supports a custom merge function', async () => {
    const merged = new ParallelStep<number, number>(
      'sum',
      { a: slow('a', 1, 1), b: slow('b', 1, 2) },
      (results) => Object.values(results).reduce<number>((total, v) => total + (v as number), 0),
    );
    const result = await createPipeline<number>().add(merged).build().run(0);
    expect(result.ok && result.value).toBe(3);
  });

  it('waits for every branch before failing, then rollback undoes the branches that succeeded', async () => {
    const log: string[] = [];
    const result = await createPipeline<number>()
      .parallel({
        ok: loggedStep('ok', log),
        bad: loggedStep('bad', log, { fail: true }),
      })
      .onError(rollbackOnError())
      .build()
      .run(1);

    expect(result.ok).toBe(false);
    expect(log).toEqual(['do:ok', 'undo:ok']);
  });

  it('a halting branch halts the pipeline', async () => {
    const halting = createPipeline<number>()
      .filter(() => false, 'branch says stop')
      .build();
    const result = await createPipeline<number>()
      .parallel({ x: halting, y: slow('y', 1, 1) })
      .build()
      .run(1);
    expect(result.status).toBe('halted');
  });
});
