import { asStep, adaptFunction } from '../adapters/FunctionStepAdapter';
import type { StepFunction, UndoFunction } from '../adapters/FunctionStepAdapter';
import { decorate } from '../decorators/decorate';
import type { StepOptions } from '../decorators/decorate';
import type { ObserverLike } from '../events/PipelineEventBus';
import { FailFastStrategy } from '../strategies/builtinStrategies';
import type { ErrorStrategy } from '../strategies/ErrorStrategy';
import { ParallelStep } from '../steps/composite/ParallelStep';
import { RouterStep } from '../steps/composite/RouterStep';
import type { Route } from '../steps/composite/RouterStep';
import {
  DedupeStep,
  FilterEachStep,
  MapEachStep,
  ReduceStep,
  SortByStep,
} from '../steps/collections';
import { EffectStep } from '../steps/EffectStep';
import { FilterStep } from '../steps/FilterStep';
import { DefaultsStep, OmitStep, PickStep, TrimStringsStep } from '../steps/objects';
import { ValidateStep } from '../steps/ValidateStep';
import type { Schema } from '../validation/rules';
import { Pipeline } from './Pipeline';
import type { PipelineContext } from './PipelineContext';
import type { AnyStep, Step, StepOutput } from './Step';

interface BuilderState {
  readonly name: string;
  readonly steps: readonly AnyStep[];
  readonly errorStrategy: ErrorStrategy;
  readonly observers: readonly ObserverLike[];
}

/** Options accepted by every builder method that adds a step. */
export interface AddOptions extends StepOptions {
  /** Name shown in events and errors. Defaults to the step kind plus its position. */
  readonly name?: string;
}

/**
 * @pattern Builder
 *
 * Assembles a `Pipeline` step by step through a fluent, typed API. `TInput` is what the
 * pipeline will receive and `TOutput` is what the steps added so far produce, so the compiler
 * checks that every step accepts what the previous one returns.
 *
 * The builder is IMMUTABLE: each method returns a new builder, so a half-built pipeline can be
 * reused as the base for several variants without them interfering with each other.
 */
export class PipelineBuilder<TInput, TOutput> {
  private constructor(private readonly state: BuilderState) {}

  static create<T>(name = 'pipeline'): PipelineBuilder<T, T> {
    return new PipelineBuilder<T, T>({
      name,
      steps: [],
      errorStrategy: new FailFastStrategy(),
      observers: [],
    });
  }

  named(name: string): PipelineBuilder<TInput, TOutput> {
    return new PipelineBuilder({ ...this.state, name });
  }

  /** Adds any `Step` (yours or a built-in one), optionally wrapped with decorators. */
  add<TNext>(
    step: Step<TOutput, TNext>,
    options: StepOptions = {},
  ): PipelineBuilder<TInput, TNext> {
    return new PipelineBuilder({
      ...this.state,
      steps: [...this.state.steps, decorate(step, options)],
    });
  }

  /** Adds a plain function as a step (Adapter). */
  map<TNext>(
    fn: StepFunction<TOutput, TNext>,
    options: AddOptions & { undo?: UndoFunction<TOutput, TNext> } = {},
  ): PipelineBuilder<TInput, TNext> {
    const { undo, ...addOptions } = options;
    return this.addNamed('map', addOptions, (name) => adaptFunction(name, fn, undo));
  }

  /** Checks fields with validation rules; every broken rule is reported together. */
  validate<T extends object>(
    this: PipelineBuilder<TInput, T>,
    schema: Schema<T>,
    options: AddOptions = {},
  ): PipelineBuilder<TInput, T> {
    return this.addNamed('validate', options, (name) => new ValidateStep<T>(schema, name));
  }

  /** Lets matching values through and halts the pipeline for the rest. */
  filter(
    predicate: (value: TOutput, ctx: PipelineContext) => boolean | Promise<boolean>,
    reason?: string,
    options: AddOptions = {},
  ): PipelineBuilder<TInput, TOutput> {
    return this.addNamed(
      'filter',
      options,
      (name) => new FilterStep<TOutput>(predicate, reason, name),
    );
  }

  /** Runs a side effect; give `undo` to make it reversible by rollback. */
  tap(
    effect: (value: TOutput, ctx: PipelineContext) => void | Promise<void>,
    undo?: (value: TOutput, ctx: PipelineContext) => void | Promise<void>,
    options: AddOptions = {},
  ): PipelineBuilder<TInput, TOutput> {
    return this.addNamed('tap', options, (name) => new EffectStep<TOutput>(effect, undo, name));
  }

  /** Keeps only the listed keys of an object. */
  pick<T extends object, K extends keyof T>(
    this: PipelineBuilder<TInput, T>,
    ...keys: K[]
  ): PipelineBuilder<TInput, Pick<T, K>> {
    return this.add(new PickStep<T, K>(keys, this.nextName('pick')));
  }

  /** Removes the listed keys of an object. */
  omit<T extends object, K extends keyof T>(
    this: PipelineBuilder<TInput, T>,
    ...keys: K[]
  ): PipelineBuilder<TInput, Omit<T, K>> {
    return this.add(new OmitStep<T, K>(keys, this.nextName('omit')));
  }

  /** Fills missing fields with default values. */
  defaults<T extends object>(
    this: PipelineBuilder<TInput, T>,
    values: Partial<T>,
  ): PipelineBuilder<TInput, T> {
    return this.add(new DefaultsStep<T>(values, this.nextName('defaults')));
  }

  /** Trims every top-level string field of an object. */
  trimStrings<T extends object>(this: PipelineBuilder<TInput, T>): PipelineBuilder<TInput, T> {
    return this.add(new TrimStringsStep<T>(this.nextName('trimStrings')));
  }

  mapEach<T, U>(
    this: PipelineBuilder<TInput, readonly T[]>,
    fn: (item: T, index: number, ctx: PipelineContext) => U | Promise<U>,
    options: AddOptions = {},
  ): PipelineBuilder<TInput, U[]> {
    return this.addNamed('mapEach', options, (name) => new MapEachStep<T, U>(fn, name));
  }

  filterEach<T>(
    this: PipelineBuilder<TInput, readonly T[]>,
    predicate: (item: T, index: number, ctx: PipelineContext) => boolean | Promise<boolean>,
    options: AddOptions = {},
  ): PipelineBuilder<TInput, T[]> {
    return this.addNamed('filterEach', options, (name) => new FilterEachStep<T>(predicate, name));
  }

  sortBy<T>(
    this: PipelineBuilder<TInput, readonly T[]>,
    key: (item: T) => number | string,
    order: 'asc' | 'desc' = 'asc',
  ): PipelineBuilder<TInput, T[]> {
    return this.add(new SortByStep<T>(key, order, this.nextName('sortBy')));
  }

  dedupe<T>(
    this: PipelineBuilder<TInput, readonly T[]>,
    key?: (item: T) => unknown,
  ): PipelineBuilder<TInput, T[]> {
    return this.add(new DedupeStep<T>(key, this.nextName('dedupe')));
  }

  reduce<T, A>(
    this: PipelineBuilder<TInput, readonly T[]>,
    reducer: (accumulator: A, item: T, index: number) => A,
    initial: A,
  ): PipelineBuilder<TInput, A> {
    return this.add(new ReduceStep<T, A>(reducer, initial, this.nextName('reduce')));
  }

  /** Conditional routing (Chain of Responsibility): first matching route wins. */
  route<TNext>(
    routes: readonly Route<TOutput, TNext>[],
    otherwise?: Step<TOutput, TNext>,
    options: AddOptions = {},
  ): PipelineBuilder<TInput, TNext> {
    return this.addNamed(
      'route',
      options,
      (name) => new RouterStep<TOutput, TNext>(name, routes, otherwise),
    );
  }

  /** Runs several branches concurrently on the same value; the output is keyed by branch name. */
  parallel<R extends Record<string, AnyStep>>(
    branches: R,
    options: AddOptions = {},
  ): PipelineBuilder<TInput, { [K in keyof R]: StepOutput<R[K]> }> {
    return this.addNamed(
      'parallel',
      options,
      (name) => new ParallelStep<TOutput, { [K in keyof R]: StepOutput<R[K]> }>(name, branches),
    );
  }

  /** Accepts a step or a plain function; handy when forwarding user-supplied handlers. */
  use<TNext>(
    stepOrFn: Step<TOutput, TNext> | StepFunction<TOutput, TNext>,
    options: AddOptions = {},
  ): PipelineBuilder<TInput, TNext> {
    return this.addNamed('use', options, (name) => asStep(name, stepOrFn));
  }

  /** Chooses the failure policy (Strategy). Default: fail fast. */
  onError(strategy: ErrorStrategy): PipelineBuilder<TInput, TOutput> {
    return new PipelineBuilder({ ...this.state, errorStrategy: strategy });
  }

  /** Subscribes an observer (or a function) to every event of every run. */
  observe(observer: ObserverLike): PipelineBuilder<TInput, TOutput> {
    return new PipelineBuilder({ ...this.state, observers: [...this.state.observers, observer] });
  }

  build(): Pipeline<TInput, TOutput> {
    return new Pipeline<TInput, TOutput>({ ...this.state });
  }

  /** Adds a step named by the caller or, by default, `<kind>-<position>` (e.g. `map-3`). */
  private addNamed<TNext>(
    kind: string,
    options: AddOptions,
    create: (name: string) => Step<TOutput, TNext>,
  ): PipelineBuilder<TInput, TNext> {
    const { name, ...decoratorOptions } = options;
    return this.add(create(name ?? this.nextName(kind)), decoratorOptions);
  }

  private nextName(kind: string): string {
    return `${kind}-${this.state.steps.length + 1}`;
  }
}
