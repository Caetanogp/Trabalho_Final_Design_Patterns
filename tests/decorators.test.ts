import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  MemoizeStep,
  RetryStep,
  StepDecorator,
  StepTimeoutError,
  TimeoutStep,
  TimingStep,
  createPipeline,
  decorate,
  rollbackOnError,
  timingKey,
  type PipelineContext,
  type Step,
} from '../src';
import { loggedStep } from './helpers';

const flaky = (failures: number) => {
  let calls = 0;
  const step: Step<number, number> = {
    name: 'flaky',
    execute: (n) => {
      calls += 1;
      if (calls <= failures) throw new Error(`fail #${calls}`);
      return n * 2;
    },
  };
  return { step, calls: () => calls };
};

describe('Decorator: RetryStep', () => {
  it('retries until the step succeeds', async () => {
    const { step, calls } = flaky(2);
    const result = await createPipeline<number>().add(step, { retry: 2 }).build().run(5);

    expect(result.ok && result.value).toBe(10);
    expect(calls()).toBe(3);
    expect(result.audit.filter((e) => e.type === 'step:retry')).toHaveLength(2);
  });

  it('gives up after the configured retries', async () => {
    const { step, calls } = flaky(10);
    const result = await createPipeline<number>().add(step, { retry: 1 }).build().run(5);
    expect(result.ok).toBe(false);
    expect(calls()).toBe(2);
  });

  it('honours shouldRetry', async () => {
    const { step, calls } = flaky(10);
    const result = await createPipeline<number>()
      .add(step, { retry: { retries: 5, shouldRetry: () => false } })
      .build()
      .run(1);
    expect(result.ok).toBe(false);
    expect(calls()).toBe(1);
  });

  it('never retries an intentional halt', async () => {
    let calls = 0;
    const haltingStep: Step<number, number> = {
      name: 'halter',
      execute: (_n, ctx: PipelineContext) => {
        calls += 1;
        return ctx.halt('stop');
      },
    };
    const result = await createPipeline<number>().add(haltingStep, { retry: 3 }).build().run(1);
    expect(result.status).toBe('halted');
    expect(calls).toBe(1);
  });

  it('applies exponential backoff', async () => {
    vi.useFakeTimers();
    const { step } = flaky(2);
    const run = createPipeline<number>()
      .add(step, { retry: { retries: 2, delayMs: 100, backoff: 2 } })
      .build()
      .run(1);

    await vi.advanceTimersByTimeAsync(100);
    await vi.advanceTimersByTimeAsync(200);
    const result = await run;
    vi.useRealTimers();

    const delays = result.audit.flatMap((e) => (e.type === 'step:retry' ? [e.delayMs] : []));
    expect(delays).toEqual([100, 200]);
    expect(result.ok).toBe(true);
  });

  it('constructor defaults to 2 retries', async () => {
    const { step, calls } = flaky(2);
    const result = await createPipeline<number>().add(new RetryStep(step)).build().run(1);
    expect(result.ok).toBe(true);
    expect(calls()).toBe(3);
  });
});

describe('Decorator: TimeoutStep', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('fails with StepTimeoutError when the step is too slow', async () => {
    const slow: Step<number, number> = {
      name: 'slow',
      execute: () => new Promise((resolve) => setTimeout(() => resolve(1), 1000)),
    };
    const run = createPipeline<number>().add(new TimeoutStep(slow, 50)).build().run(0);
    await vi.advanceTimersByTimeAsync(60);
    const result = await run;

    expect(result.status).toBe('failed');
    if (result.status === 'failed') {
      expect((result.error as { cause?: unknown }).cause).toBeInstanceOf(StepTimeoutError);
    }
  });

  it('lets fast steps through', async () => {
    const fast: Step<number, number> = { name: 'fast', execute: (n) => n + 1 };
    const result = await createPipeline<number>().add(fast, { timeoutMs: 1000 }).build().run(1);
    expect(result.ok && result.value).toBe(2);
  });
});

describe('Decorator: TimingStep and MemoizeStep', () => {
  it('stores the duration in the context and calls onTiming', async () => {
    const seen: string[] = [];
    const inner: Step<number, number> = { name: 'work', execute: (n) => n };
    let stored: number | undefined;
    const result = await createPipeline<number>()
      .add(new TimingStep(inner, (name) => void seen.push(name)))
      .tap((_n, ctx) => {
        stored = ctx.get<number>(timingKey('work'));
      })
      .build()
      .run(1);

    expect(result.ok).toBe(true);
    expect(seen).toEqual(['work']);
    expect(stored).toBeGreaterThanOrEqual(0);
  });

  it('timing: true option works too', async () => {
    const result = await createPipeline<number>()
      .map((n) => n, { name: 'timed', timing: true })
      .build()
      .run(1);
    expect(result.ok).toBe(true);
  });

  it('memoizes by input and can expire entries', async () => {
    vi.useFakeTimers();
    let calls = 0;
    const inner: Step<number, number> = {
      name: 'lookup',
      execute: (n) => {
        calls += 1;
        return n * 2;
      },
    };
    const memo = new MemoizeStep(inner, { ttlMs: 1000 });
    const pipeline = createPipeline<number>().add(memo).build();

    await pipeline.run(2);
    await pipeline.run(2);
    expect(calls).toBe(1);
    await pipeline.run(3);
    expect(calls).toBe(2);

    vi.advanceTimersByTime(1500);
    await pipeline.run(2);
    expect(calls).toBe(3);

    memo.clear();
    await pipeline.run(2);
    expect(calls).toBe(4);
    vi.useRealTimers();
  });

  it('memoize option and custom key', async () => {
    let calls = 0;
    const pipeline = createPipeline<{ id: number; noise: number }>()
      .map(
        (v) => {
          calls += 1;
          return v.id;
        },
        { memoize: { keyOf: (v) => String(v.id) } },
      )
      .build();
    await pipeline.run({ id: 1, noise: 1 });
    await pipeline.run({ id: 1, noise: 2 });
    expect(calls).toBe(1);

    const flag = createPipeline<number>()
      .map((n) => n, { memoize: true })
      .build();
    expect((await flag.run(1)).ok).toBe(true);
  });
});

describe('Decorator: composition and compensation', () => {
  it('decorators stack and keep the inner step reversible', async () => {
    const log: string[] = [];
    const result = await createPipeline<number>()
      .add(loggedStep('save', log), { retry: 1, timeoutMs: 1000, timing: true })
      .add(loggedStep('boom', log, { fail: true }))
      .onError(rollbackOnError())
      .build()
      .run(1);

    expect(log).toEqual(['do:save', 'undo:save']);
    expect(result.ok).toBe(false);
  });

  it('names reveal the wrapping order', () => {
    const base: Step<number, number> = { name: 'base', execute: (n) => n };
    expect(decorate(base, { timeoutMs: 10, retry: 1, timing: true, memoize: true }).name).toBe(
      'memoize(timing(retry(timeout(base))))',
    );
  });

  it('a client can write a custom decorator without touching the library', async () => {
    class LogDecorator<I, O> extends StepDecorator<I, O> {
      constructor(
        inner: Step<I, O>,
        private readonly lines: string[],
      ) {
        super(inner, 'log');
      }

      override async execute(input: I, ctx: PipelineContext): Promise<O> {
        this.lines.push(`before ${this.inner.name}`);
        const output = await this.inner.execute(input, ctx);
        this.lines.push(`after ${this.inner.name}`);
        return output;
      }
    }

    const lines: string[] = [];
    const inner: Step<number, number> = { name: 'inc', execute: (n) => n + 1 };
    const result = await createPipeline<number>()
      .add(new LogDecorator(inner, lines))
      .build()
      .run(1);
    expect(result.ok && result.value).toBe(2);
    expect(lines).toEqual(['before inc', 'after inc']);
  });
});
