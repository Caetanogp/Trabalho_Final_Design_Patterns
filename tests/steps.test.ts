import { describe, expect, it } from 'vitest';
import {
  DedupeStep,
  DefaultsStep,
  EffectStep,
  FilterEachStep,
  MapEachStep,
  OmitStep,
  PickStep,
  ReduceStep,
  SortByStep,
  TrimStringsStep,
  ValidateStep,
  ValidationError,
  adaptFunction,
  asStep,
  createPipeline,
  custom,
  isEmail,
  isNumber,
  isString,
  matches,
  maxLength,
  minLength,
  oneOf,
  range,
  required,
  type Rule,
} from '../src';

interface User {
  name: string;
  email: string;
  age?: number;
}

describe('ValidateStep and rules', () => {
  const schema = {
    name: [required(), minLength(2)],
    email: [required(), isEmail()],
    age: range(18, 120),
  };

  it('passes a valid object through untouched', async () => {
    const user: User = { name: 'Ana', email: 'ana@x.com', age: 30 };
    const result = await createPipeline<User>().validate(schema).build().run(user);
    expect(result.ok && result.value).toBe(user);
  });

  it('reports every broken rule at once', async () => {
    const result = await createPipeline<User>()
      .validate(schema)
      .build()
      .run({ name: '', email: 'nope', age: 5 });

    expect(result.status).toBe('failed');
    if (result.status === 'failed') {
      const cause = (result.error as { cause?: unknown }).cause as ValidationError;
      expect(cause).toBeInstanceOf(ValidationError);
      expect(cause.issues.map((i) => i.field).sort()).toEqual(['age', 'email', 'name']);
      expect(cause.message).toContain('email: must be a valid e-mail');
    }
  });

  it('rejects a non-object input', async () => {
    const result = await createPipeline<User>()
      .validate(schema)
      .build()
      .run(null as unknown as User);
    expect(result.ok).toBe(false);
  });

  it('supports async custom rules', async () => {
    const unique: Rule<string> = custom(async (email) => email !== 'taken@x.com', 'already used');
    const pipeline = createPipeline<User>().validate({ email: unique }).build();
    expect((await pipeline.run({ name: 'a', email: 'free@x.com' })).ok).toBe(true);
    expect((await pipeline.run({ name: 'a', email: 'taken@x.com' })).ok).toBe(false);
  });

  it('exposes all the ready-made rules', async () => {
    const check = async (rule: Rule, value: unknown) => rule(value, 'f');
    expect(await check(required(), '  ')).toBe('is required');
    expect(await check(required(), [])).toBe('is required');
    expect(await check(required(), 0)).toBeNull();
    expect(await check(isString(), 3)).toBe('must be a string');
    expect(await check(isNumber(), 'x')).toBe('must be a number');
    expect(await check(isNumber(), 4)).toBeNull();
    expect(await check(maxLength(3), 'abcd')).toBe('must have at most 3 characters');
    expect(await check(matches(/^a/), 'b')).toBe('must match /^a/');
    expect(await check(oneOf(['a', 'b']), 'c')).toBe('must be one of: a, b');
    expect(await check(oneOf(['a', 'b']), 'a')).toBeNull();
    expect(await check(minLength(3, 'short'), 'ab')).toBe('short');
    // empty values are accepted by format rules (use required() to forbid them)
    expect(await check(isEmail(), undefined)).toBeNull();
    expect(await check(range(1, 2), null)).toBeNull();
  });
});

describe('FilterStep (halt)', () => {
  it('lets matching values through', async () => {
    const result = await createPipeline<number>()
      .filter((n) => n > 0)
      .build()
      .run(5);
    expect(result.ok && result.value).toBe(5);
  });

  it('halts, without error or rollback, when the predicate is false', async () => {
    const result = await createPipeline<number>()
      .filter((n) => n > 0, 'must be positive', { name: 'positive' })
      .map((n) => n * 2)
      .build()
      .run(-1);

    expect(result.status).toBe('halted');
    if (result.status === 'halted') {
      expect(result.reason).toBe('must be positive');
      expect(result.haltedAt).toBe('positive');
      expect(result.input).toBe(-1);
    }
    expect(result.audit.map((e) => e.type)).toContain('step:halted');
    expect(result.audit.map((e) => e.type)).toContain('pipeline:halted');
  });
});

describe('EffectStep', () => {
  it('passes the input through and runs the effect', async () => {
    const seen: number[] = [];
    const result = await createPipeline<number>()
      .tap((n) => void seen.push(n))
      .build()
      .run(3);
    expect(seen).toEqual([3]);
    expect(result.ok && result.value).toBe(3);
  });

  it('only exposes compensate when an undo was provided', () => {
    expect(new EffectStep(() => undefined).compensate).toBeUndefined();
    expect(
      new EffectStep(
        () => undefined,
        () => undefined,
      ).compensate,
    ).toBeTypeOf('function');
  });
});

describe('collection steps', () => {
  const people = [
    { id: 1, name: 'Bia', age: 31 },
    { id: 2, name: 'Caio', age: 25 },
    { id: 1, name: 'Bia (dup)', age: 31 },
    { id: 3, name: 'Ana', age: 40 },
  ];

  it('mapEach, filterEach, sortBy, dedupe and reduce compose', async () => {
    const result = await createPipeline<typeof people>()
      .dedupe((p) => p.id)
      .filterEach((p) => p.age >= 30)
      .sortBy((p) => p.name)
      .mapEach((p) => p.name)
      .build()
      .run(people);
    expect(result.ok && result.value).toEqual(['Ana', 'Bia']);

    const sum = await createPipeline<typeof people>()
      .reduce((total, p) => total + p.age, 0)
      .build()
      .run(people);
    expect(sum.ok && sum.value).toBe(127);
  });

  it('sortBy supports descending order and never mutates the input', async () => {
    const input = [3, 1, 2];
    const result = await createPipeline<number[]>()
      .sortBy((n) => n, 'desc')
      .build()
      .run(input);
    expect(result.ok && result.value).toEqual([3, 2, 1]);
    expect(input).toEqual([3, 1, 2]);
  });

  it('dedupe defaults to identity', async () => {
    const result = await createPipeline<number[]>().dedupe().build().run([1, 1, 2]);
    expect(result.ok && result.value).toEqual([1, 2]);
  });

  it('every collection step rejects non-arrays', async () => {
    for (const step of [
      new MapEachStep((x) => x),
      new FilterEachStep(() => true),
      new SortByStep((x: unknown) => String(x)),
      new DedupeStep(),
      new ReduceStep((a: number) => a, 0),
    ]) {
      const result = await createPipeline<unknown>()
        .add(step as never)
        .build()
        .run('not an array');
      expect(result.ok, step.name).toBe(false);
    }
  });

  it('mapEach supports async functions and gives the index', async () => {
    const result = await createPipeline<string[]>()
      .mapEach(async (s, i) => `${i}:${s}`)
      .build()
      .run(['a', 'b']);
    expect(result.ok && result.value).toEqual(['0:a', '1:b']);
  });
});

describe('object steps', () => {
  it('pick, omit, defaults and trimStrings', async () => {
    const result = await createPipeline<{ a: string; b: number; c?: string; d?: number }>()
      .trimStrings()
      .defaults({ d: 9 })
      .omit('b')
      .pick('a', 'c', 'd')
      .build()
      .run({ a: '  hi  ', b: 1, c: undefined });
    expect(result.ok && result.value).toEqual({ a: 'hi', d: 9 });
  });

  it('can be used directly as steps', async () => {
    const ctx = undefined as never;
    expect(
      await new PickStep<{ x: number; y: number }, 'x'>(['x']).execute({ x: 1, y: 2 }, ctx),
    ).toEqual({ x: 1 });
    expect(
      await new OmitStep<{ x: number; y: number }, 'x'>(['x']).execute({ x: 1, y: 2 }, ctx),
    ).toEqual({ y: 2 });
    expect(await new DefaultsStep<{ x?: number }>({ x: 5 }).execute({}, ctx)).toEqual({ x: 5 });
    expect(await new TrimStringsStep<{ x: string }>().execute({ x: ' a ' }, ctx)).toEqual({
      x: 'a',
    });
    expect(await new ValidateStep<{ x: number }>({ x: required() }).execute({ x: 1 }, ctx)).toEqual(
      { x: 1 },
    );
  });
});

describe('Adapter', () => {
  it('adapts a function to a Step, with optional undo', () => {
    const plain = adaptFunction('plain', (n: number) => n + 1);
    expect(plain.name).toBe('plain');
    expect(plain.compensate).toBeUndefined();

    const reversible = adaptFunction(
      'rev',
      (n: number) => n,
      () => undefined,
    );
    expect(reversible.compensate).toBeTypeOf('function');
  });

  it('asStep accepts a step or a function', () => {
    const step = adaptFunction('s', (n: number) => n);
    expect(asStep('x', step)).toBe(step);
    expect(asStep('fn', (n: number) => n).name).toBe('fn');
  });

  it('use() accepts either', async () => {
    const result = await createPipeline<number>()
      .use((n) => n + 1)
      .use(adaptFunction('times3', (n: number) => n * 3))
      .build()
      .run(1);
    expect(result.ok && result.value).toBe(6);
  });
});
