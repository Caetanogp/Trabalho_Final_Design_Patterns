import { describe, expect, it } from 'vitest';
import {
  AbstractStep,
  PipelineBuilder,
  StepDecorator,
  createPipeline,
  rollbackOnError,
  type ErrorStrategy,
  type PipelineContext,
  type PipelineEvent,
  type PipelineObserver,
  type Rule,
  type Step,
} from '../src';

/**
 * Everything below is "client code": it only imports the public API and adds new behaviour
 * by writing new classes. No file under src/ is modified (Open/Closed Principle).
 */
describe('Open/Closed: the client extends the library without touching it', () => {
  it('Template Method: a custom step only implements process() and may use the hooks', async () => {
    const trace: string[] = [];

    class UppercaseStep extends AbstractStep<string, string> {
      protected override validateInput(input: string): void {
        if (typeof input !== 'string') throw new TypeError('expected a string');
        trace.push('validate');
      }
      protected override before(): void {
        trace.push('before');
      }
      protected override process(input: string): string {
        trace.push('process');
        return input.toUpperCase();
      }
      protected override after(output: string): void {
        trace.push(`after:${output}`);
      }
    }

    const result = await createPipeline<string>().add(new UppercaseStep()).build().run('abc');
    expect(result.ok && result.value).toBe('ABC');
    expect(trace).toEqual(['validate', 'before', 'process', 'after:ABC']);

    const invalid = await createPipeline<unknown>()
      .add(new UppercaseStep() as Step<unknown, string>)
      .build()
      .run(42);
    expect(invalid.ok).toBe(false);
  });

  it('AbstractStep names default to the subclass name', () => {
    class MyStep extends AbstractStep<number, number> {
      protected process(n: number) {
        return n;
      }
    }
    expect(new MyStep().name).toBe('MyStep');
  });

  it('Command: a custom reversible step participates in rollback', async () => {
    const database = new Map<string, string>();

    class InsertRowStep implements Step<
      { id: string; name: string },
      { id: string; name: string }
    > {
      readonly name = 'insert-row';
      execute(row: { id: string; name: string }) {
        database.set(row.id, row.name);
        return row;
      }
      compensate(row: { id: string; name: string }) {
        database.delete(row.id);
      }
    }

    const result = await createPipeline<{ id: string; name: string }>()
      .add(new InsertRowStep())
      .map(() => {
        throw new Error('downstream failure');
      })
      .onError(rollbackOnError())
      .build()
      .run({ id: '1', name: 'Ana' });

    expect(result.ok).toBe(false);
    expect(database.size).toBe(0);
  });

  it('Observer: a custom observer receives every event', async () => {
    class SlackLikeAlerter implements PipelineObserver {
      readonly alerts: string[] = [];
      onEvent(event: PipelineEvent): void {
        if (event.type === 'pipeline:failed') this.alerts.push(`ALERT ${event.error.message}`);
      }
    }
    const alerter = new SlackLikeAlerter();
    await createPipeline<number>()
      .observe(alerter)
      .map(() => {
        throw new Error('db down');
      })
      .build()
      .run(1);
    expect(alerter.alerts).toEqual(['ALERT Step "map-1" failed: db down']);
  });

  it('Decorator: a custom circuit breaker wraps any step', async () => {
    class CircuitBreaker<I, O> extends StepDecorator<I, O> {
      private failures = 0;
      constructor(
        inner: Step<I, O>,
        private readonly threshold: number,
      ) {
        super(inner, 'circuit');
      }
      override async execute(input: I, ctx: PipelineContext): Promise<O> {
        if (this.failures >= this.threshold) throw new Error('circuit open');
        try {
          return await this.inner.execute(input, ctx);
        } catch (error) {
          this.failures += 1;
          throw error;
        }
      }
    }

    let calls = 0;
    const unstable: Step<number, number> = {
      name: 'unstable',
      execute: () => {
        calls += 1;
        throw new Error('down');
      },
    };
    const pipeline = createPipeline<number>().add(new CircuitBreaker(unstable, 2)).build();

    await pipeline.run(1);
    await pipeline.run(1);
    const third = await pipeline.run(1);

    expect(calls).toBe(2); // the third call never reached the unstable step
    expect(third.status === 'failed' && third.error.message).toContain('circuit open');
  });

  it('Strategy: a custom error strategy decides per failure', async () => {
    const tolerant: ErrorStrategy = {
      name: 'tolerate-validation',
      handle: ({ error }) =>
        error.message.includes('minor') ? { action: 'skip' } : { action: 'abort' },
    };
    const run = (message: string) =>
      createPipeline<number>()
        .map(() => {
          throw new Error(message);
        })
        .map((n) => n)
        .onError(tolerant)
        .build()
        .run(1);

    expect((await run('minor glitch')).ok).toBe(true);
    expect((await run('major crash')).ok).toBe(false);
  });

  it('Validation: a custom rule plugs into validate()', async () => {
    const isEven: Rule<number> = (value) => (value % 2 === 0 ? null : 'must be even');
    const pipeline = createPipeline<{ qty: number }>().validate({ qty: isEven }).build();
    expect((await pipeline.run({ qty: 4 })).ok).toBe(true);
    expect((await pipeline.run({ qty: 3 })).ok).toBe(false);
  });

  it('Builder: is immutable, so a base pipeline can be reused for variants', async () => {
    const base = createPipeline<number>('base').map((n) => n + 1);
    const doubled = base.map((n) => n * 2).build();
    const squared = base.map((n) => n * n).build();
    const plain = base.build();

    expect((await doubled.run(2)).ok && (await doubled.run(2))).toMatchObject({ value: 6 });
    expect((await squared.run(2)).ok && (await squared.run(2))).toMatchObject({ value: 9 });
    expect((await plain.run(2)).ok && (await plain.run(2))).toMatchObject({ value: 3 });
    expect(plain.steps).toHaveLength(1);
    expect(base.named('renamed').build().name).toBe('renamed');
    expect(PipelineBuilder.create<number>().build().name).toBe('pipeline');
  });
});
