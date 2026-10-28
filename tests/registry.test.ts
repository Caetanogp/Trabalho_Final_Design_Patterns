import { describe, expect, it } from 'vitest';
import {
  AbstractStep,
  InvalidDefinitionError,
  StepRegistry,
  UnknownStepTypeError,
  createPipelineFromDefinition,
  evaluateCondition,
  readPath,
  ruleFromSpec,
  type Condition,
  type PipelineDefinition,
} from '../src';

describe('Factory Method + Registry', () => {
  it('lists the built-in step types', () => {
    expect(StepRegistry.withDefaults().types()).toEqual([
      'dedupe',
      'defaults',
      'filter',
      'filterEach',
      'omit',
      'pick',
      'pipeline',
      'route',
      'sortBy',
      'trimStrings',
      'validate',
    ]);
  });

  it('builds a working pipeline from a JSON definition', async () => {
    const definition: PipelineDefinition = {
      name: 'signup',
      steps: [
        { type: 'trimStrings' },
        {
          type: 'validate',
          config: {
            rules: {
              email: ['required', 'email'],
              name: [{ minLength: 2 }],
              age: { range: [18, 99] },
            },
          },
        },
        { type: 'defaults', config: { values: { role: 'user' } } },
        { type: 'omit', config: { keys: ['password'] } },
      ],
    };
    const pipeline = createPipelineFromDefinition(definition);

    const ok = await pipeline.run({ email: ' a@b.com ', name: ' Ana ', age: 30, password: 'x' });
    expect(ok.ok && ok.value).toEqual({ email: 'a@b.com', name: 'Ana', age: 30, role: 'user' });
    expect(pipeline.name).toBe('signup');

    const bad = await pipeline.run({ email: 'nope', name: 'A', age: 3 });
    expect(bad.ok).toBe(false);
  });

  it('supports filter, filterEach, sortBy, dedupe and pick from JSON', async () => {
    const pipeline = createPipelineFromDefinition({
      steps: [
        { type: 'dedupe', config: { key: 'id' } },
        { type: 'filterEach', config: { where: { field: 'age', op: 'gte', value: 18 } } },
        { type: 'sortBy', config: { key: 'name', order: 'desc' } },
      ],
    });
    const result = await pipeline.run([
      { id: 1, name: 'Ana', age: 20 },
      { id: 1, name: 'Ana', age: 20 },
      { id: 2, name: 'Zed', age: 10 },
      { id: 3, name: 'Bob', age: 40 },
    ]);
    expect(result.ok && (result.value as { name: string }[]).map((p) => p.name)).toEqual([
      'Bob',
      'Ana',
    ]);

    const guarded = createPipelineFromDefinition({
      steps: [
        {
          type: 'filter',
          config: { where: { field: 'active', op: 'eq', value: true }, reason: 'inactive' },
        },
        { type: 'pick', config: { keys: ['id'] } },
      ],
    });
    expect((await guarded.run({ id: 1, active: true, x: 1 })).ok).toBe(true);
    expect((await guarded.run({ id: 1, active: false })).status).toBe('halted');
  });

  it('routes and nests sub-pipelines from JSON', async () => {
    const pipeline = createPipelineFromDefinition({
      steps: [
        {
          type: 'route',
          name: 'by-country',
          config: {
            routes: [
              {
                name: 'br',
                when: { field: 'country', op: 'eq', value: 'BR' },
                steps: [{ type: 'defaults', config: { values: { currency: 'BRL' } } }],
              },
            ],
            otherwise: [{ type: 'defaults', config: { values: { currency: 'USD' } } }],
          },
        },
        { type: 'pipeline', config: { steps: [{ type: 'pick', config: { keys: ['currency'] } }] } },
      ],
    });
    expect(
      (await pipeline.run({ country: 'BR' })).ok && (await pipeline.run({ country: 'BR' })),
    ).toMatchObject({
      value: { currency: 'BRL' },
    });
    expect(
      (await pipeline.run({ country: 'US' })).ok && (await pipeline.run({ country: 'US' })),
    ).toMatchObject({
      value: { currency: 'USD' },
    });
  });

  it('applies retry and timeout decorators declared in the definition', () => {
    const registry = StepRegistry.withDefaults();
    const step = registry.create({ type: 'trimStrings', name: 't', retry: 2, timeoutMs: 100 });
    expect(step.name).toBe('retry(timeout(t))');
  });

  it('selects the error strategy by name', async () => {
    const definition = (errorStrategy?: string): PipelineDefinition => ({
      errorStrategy,
      steps: [{ type: 'validate', config: { rules: { a: ['required'] } } }],
    });
    const skip = await createPipelineFromDefinition(definition('continue-on-error')).run({});
    expect(skip.ok).toBe(true);
    const rollback = await createPipelineFromDefinition(definition('rollback-on-error')).run({});
    expect(rollback.status === 'failed' && rollback.rolledBack).toBe(true);
    expect((await createPipelineFromDefinition(definition('fail-fast')).run({})).ok).toBe(false);
  });

  it('reports clear errors for invalid definitions', () => {
    const registry = StepRegistry.withDefaults();
    expect(() => registry.create({ type: 'nope' })).toThrow(UnknownStepTypeError);
    expect(() => registry.create({ type: 'nope' })).toThrow(/Registered types: .*validate/);
    expect(() => registry.create({ type: 'pick' })).toThrow(InvalidDefinitionError);
    expect(() => registry.create({ type: 'validate' })).toThrow(/requires "rules"/);
    expect(() => registry.createPipeline({ steps: undefined as never })).toThrow(/"steps" array/);
    expect(() => registry.createPipeline({ steps: [], errorStrategy: 'weird' })).toThrow(
      /Unknown error strategy/,
    );
  });

  it('lets the client register new step types and strategies (Open/Closed)', async () => {
    class SlugifyStep extends AbstractStep<{ title: string }, { title: string; slug: string }> {
      constructor(private readonly separator: string) {
        super('slugify');
      }
      protected process(input: { title: string }) {
        return {
          ...input,
          slug: input.title.toLowerCase().replace(/\s+/g, this.separator),
        };
      }
    }

    const registry = StepRegistry.withDefaults()
      .register<{ separator?: string }>(
        'slugify',
        (config) => new SlugifyStep(config.separator ?? '-'),
      )
      .registerStrategy('always-skip', () => ({
        name: 'skip',
        handle: () => ({ action: 'skip' }),
      }));

    expect(registry.has('slugify')).toBe(true);
    const pipeline = createPipelineFromDefinition(
      { errorStrategy: 'always-skip', steps: [{ type: 'slugify', config: { separator: '_' } }] },
      registry,
    );
    const result = await pipeline.run({ title: 'Hello Big World' });
    expect(result.ok && result.value).toEqual({
      title: 'Hello Big World',
      slug: 'hello_big_world',
    });
  });
});

describe('declarative conditions and rule specs', () => {
  const subject = { n: 5, s: 'hello world', tags: ['a', 'b'], nested: { deep: 1 }, nothing: null };
  const check = (condition: Condition) => evaluateCondition(condition, subject);

  it('evaluates every operator', () => {
    expect(check({ field: 'n', op: 'eq', value: 5 })).toBe(true);
    expect(check({ field: 'n', op: 'neq', value: 5 })).toBe(false);
    expect(check({ field: 'n', op: 'gt', value: 4 })).toBe(true);
    expect(check({ field: 'n', op: 'gte', value: 5 })).toBe(true);
    expect(check({ field: 'n', op: 'lt', value: 5 })).toBe(false);
    expect(check({ field: 'n', op: 'lte', value: 5 })).toBe(true);
    expect(check({ field: 'n', op: 'in', value: [1, 5] })).toBe(true);
    expect(check({ field: 'n', op: 'in', value: 'not array' })).toBe(false);
    expect(check({ field: 's', op: 'contains', value: 'world' })).toBe(true);
    expect(check({ field: 'tags', op: 'contains', value: 'b' })).toBe(true);
    expect(check({ field: 's', op: 'matches', value: '^hello' })).toBe(true);
    expect(check({ field: 'n', op: 'matches', value: '5' })).toBe(false);
    expect(check({ field: 'nested.deep', op: 'exists' })).toBe(true);
    expect(check({ field: 'nothing', op: 'exists' })).toBe(false);
    expect(check({ field: 'missing.path', op: 'exists' })).toBe(false);
  });

  it('works on the value itself when no field is given and rejects unknown operators', () => {
    expect(evaluateCondition({ op: 'eq', value: 3 }, 3)).toBe(true);
    expect(readPath({ a: 1 })).toEqual({ a: 1 });
    expect(() => evaluateCondition({ op: 'bogus' as never }, 1)).toThrow(InvalidDefinitionError);
  });

  it('turns rule specs into rules and rejects unknown ones', async () => {
    expect(await ruleFromSpec('required')('', 'f')).toBe('is required');
    expect(await ruleFromSpec('email')('x', 'f')).not.toBeNull();
    expect(await ruleFromSpec('string')(1, 'f')).not.toBeNull();
    expect(await ruleFromSpec('number')('x', 'f')).not.toBeNull();
    expect(await ruleFromSpec({ minLength: 3 })('ab', 'f')).not.toBeNull();
    expect(await ruleFromSpec({ maxLength: 1 })('ab', 'f')).not.toBeNull();
    expect(await ruleFromSpec({ range: [1, 3] })(9, 'f')).not.toBeNull();
    expect(await ruleFromSpec({ matches: '^a' })('b', 'f')).not.toBeNull();
    expect(await ruleFromSpec({ oneOf: ['a'] })('b', 'f')).not.toBeNull();
    expect(() => ruleFromSpec('bogus' as never)).toThrow(InvalidDefinitionError);
    expect(() => ruleFromSpec({ bogus: 1 } as never)).toThrow(InvalidDefinitionError);
  });
});
