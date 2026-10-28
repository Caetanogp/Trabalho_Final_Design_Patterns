import { InvalidDefinitionError, UnknownStepTypeError } from '../core/errors';
import { Pipeline } from '../core/Pipeline';
import type { AnyStep } from '../core/Step';
import { decorate } from '../decorators/decorate';
import type { RetryOptions } from '../decorators/RetryStep';
import {
  ContinueOnErrorStrategy,
  FailFastStrategy,
  RollbackOnErrorStrategy,
} from '../strategies/builtinStrategies';
import type { ErrorStrategy } from '../strategies/ErrorStrategy';
import { DedupeStep, FilterEachStep, SortByStep } from '../steps/collections';
import { RouterStep } from '../steps/composite/RouterStep';
import { FilterStep } from '../steps/FilterStep';
import { DefaultsStep, OmitStep, PickStep, TrimStringsStep } from '../steps/objects';
import { ValidateStep } from '../steps/ValidateStep';
import type { Rule, Schema } from '../validation/rules';
import { evaluateCondition, readPath } from './conditions';
import type { Condition } from './conditions';
import { ruleFromSpec } from './ruleSpecs';
import type { RuleSpec } from './ruleSpecs';

/** Declarative description of one step; this is what a JSON pipeline file contains. */
export interface StepDefinition {
  readonly type: string;
  readonly name?: string;
  readonly config?: Record<string, unknown>;
  readonly retry?: number | RetryOptions;
  readonly timeoutMs?: number;
}

export interface PipelineDefinition {
  readonly name?: string;
  /** Name of a registered error strategy. Built-ins: fail-fast, continue-on-error, rollback-on-error. */
  readonly errorStrategy?: string;
  readonly steps: readonly StepDefinition[];
}

/**
 * Builds a step from its `config`. The registry is passed along so factories of composite
 * steps (routers, sub-pipelines) can create their children.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type StepFactory<TConfig = any> = (
  config: TConfig,
  registry: StepRegistry,
  definition: StepDefinition,
) => AnyStep;

export type StrategyFactory = () => ErrorStrategy;

/**
 * @pattern Factory Method + Registry
 *
 * Creating a step from a type name (`"validate"`, `"slugify"`...) is delegated to the factory
 * registered under that name. The registry never hard-codes the list of steps, so clients add
 * their own types with `register(...)` and pipelines described as JSON can use them with no
 * change to the library (Open/Closed Principle).
 */
export class StepRegistry {
  private readonly factories = new Map<string, StepFactory>();
  private readonly strategies = new Map<string, StrategyFactory>();

  /** A registry already loaded with every built-in step type and error strategy. */
  static withDefaults(): StepRegistry {
    const registry = new StepRegistry();
    registerBuiltins(registry);
    return registry;
  }

  register<TConfig>(type: string, factory: StepFactory<TConfig>): this {
    this.factories.set(type, factory);
    return this;
  }

  registerStrategy(name: string, factory: StrategyFactory): this {
    this.strategies.set(name, factory);
    return this;
  }

  has(type: string): boolean {
    return this.factories.has(type);
  }

  types(): string[] {
    return [...this.factories.keys()].sort();
  }

  /** Factory Method: instantiates (and decorates) the step described by `definition`. */
  create(definition: StepDefinition): AnyStep {
    const factory = this.factories.get(definition.type);
    if (!factory) throw new UnknownStepTypeError(definition.type, this.types());
    const step = factory(definition.config ?? {}, this, definition);
    return decorate(step, { retry: definition.retry, timeoutMs: definition.timeoutMs });
  }

  createPipeline<TInput = unknown, TOutput = unknown>(
    definition: PipelineDefinition,
  ): Pipeline<TInput, TOutput> {
    if (!Array.isArray(definition.steps)) {
      throw new InvalidDefinitionError('A pipeline definition needs a "steps" array');
    }
    return new Pipeline<TInput, TOutput>({
      name: definition.name,
      steps: definition.steps.map((step) => this.create(step)),
      errorStrategy: this.createStrategy(definition.errorStrategy),
    });
  }

  private createStrategy(name?: string): ErrorStrategy {
    if (name === undefined) return new FailFastStrategy();
    const factory = this.strategies.get(name);
    if (!factory) {
      throw new InvalidDefinitionError(
        `Unknown error strategy "${name}". Registered: ${[...this.strategies.keys()].join(', ')}`,
      );
    }
    return factory();
  }
}

function need<T>(value: T | undefined, what: string, type: string): T {
  if (value === undefined)
    throw new InvalidDefinitionError(`Step type "${type}" requires "${what}"`);
  return value;
}

function registerBuiltins(registry: StepRegistry): void {
  registerStrategies(registry);
  registerObjectSteps(registry);
  registerCollectionSteps(registry);
  registerFlowSteps(registry);
}

function registerStrategies(registry: StepRegistry): void {
  registry
    .registerStrategy('fail-fast', () => new FailFastStrategy())
    .registerStrategy('continue-on-error', () => new ContinueOnErrorStrategy())
    .registerStrategy('rollback-on-error', () => new RollbackOnErrorStrategy());
}

/** Steps that validate, reshape or filter a single value. */
function registerObjectSteps(registry: StepRegistry): void {
  registry
    .register<{ rules: Record<string, RuleSpec | RuleSpec[]> }>('validate', (config, _r, def) => {
      const schema: Record<string, Rule[]> = {};
      for (const [field, specs] of Object.entries(need(config.rules, 'rules', 'validate'))) {
        schema[field] = (Array.isArray(specs) ? specs : [specs]).map(ruleFromSpec);
      }
      return new ValidateStep(schema as Schema<object>, def.name);
    })
    .register<{ keys: string[] }>(
      'pick',
      (config, _r, def) =>
        new PickStep<Record<string, unknown>, string>(need(config.keys, 'keys', 'pick'), def.name),
    )
    .register<{ keys: string[] }>(
      'omit',
      (config, _r, def) =>
        new OmitStep<Record<string, unknown>, string>(need(config.keys, 'keys', 'omit'), def.name),
    )
    .register<{ values: Record<string, unknown> }>(
      'defaults',
      (config, _r, def) => new DefaultsStep(need(config.values, 'values', 'defaults'), def.name),
    )
    .register('trimStrings', (_config, _r, def) => new TrimStringsStep(def.name))
    .register<{ where: Condition; reason?: string }>('filter', (config, _r, def) => {
      const where = need(config.where, 'where', 'filter');
      return new FilterStep((value) => evaluateCondition(where, value), config.reason, def.name);
    });
}

/** Steps that work on arrays. */
function registerCollectionSteps(registry: StepRegistry): void {
  registry
    .register<{ where: Condition }>('filterEach', (config, _r, def) => {
      const where = need(config.where, 'where', 'filterEach');
      return new FilterEachStep((item) => evaluateCondition(where, item), def.name);
    })
    .register<{ key: string; order?: 'asc' | 'desc' }>('sortBy', (config, _r, def) => {
      const key = need(config.key, 'key', 'sortBy');
      return new SortByStep(
        (item) => readPath(item, key) as string | number,
        config.order,
        def.name,
      );
    })
    .register<{ key?: string }>(
      'dedupe',
      (config, _r, def) =>
        new DedupeStep(config.key ? (item) => readPath(item, config.key) : undefined, def.name),
    );
}

/** Steps that contain other steps: sub-pipelines and routers. */
function registerFlowSteps(registry: StepRegistry): void {
  registry
    .register<{ steps: StepDefinition[] }>('pipeline', (config, r, def) =>
      r.createPipeline({ name: def.name, steps: need(config.steps, 'steps', 'pipeline') }),
    )
    .register<{
      routes: { name?: string; when: Condition; steps: StepDefinition[] }[];
      otherwise?: StepDefinition[];
    }>('route', (config, r, def) => {
      const routes = need(config.routes, 'routes', 'route').map((route, index) => ({
        name: route.name ?? `route-${index + 1}`,
        when: (value: unknown) => evaluateCondition(route.when, value),
        step: r.createPipeline({ name: route.name, steps: route.steps }),
      }));
      const otherwise = config.otherwise
        ? r.createPipeline({ name: 'otherwise', steps: config.otherwise })
        : undefined;
      return new RouterStep(def.name ?? 'route', routes, otherwise);
    });
}
