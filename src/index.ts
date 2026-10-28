import { PipelineBuilder } from './core/PipelineBuilder';
import { StepRegistry } from './registry/StepRegistry';
import type { PipelineDefinition } from './registry/StepRegistry';
import type { Pipeline } from './core/Pipeline';

/**
 * @pattern Facade
 *
 * The single entry point most clients need. It hides the builder, the default strategy, the
 * event bus and the context behind two functions; everything else stays available below for
 * clients who want to extend the library.
 *
 * ```ts
 * const result = await createPipeline<User>('signup')
 *   .validate({ email: [required(), isEmail()] })
 *   .map((u) => ({ ...u, email: u.email.toLowerCase() }))
 *   .build()
 *   .run(input);
 * ```
 */
export function createPipeline<TInput>(name = 'pipeline'): PipelineBuilder<TInput, TInput> {
  return PipelineBuilder.create<TInput>(name);
}

/** Builds a pipeline from a JSON-like definition using the built-in step types (or your registry). */
export function createPipelineFromDefinition<TInput = unknown, TOutput = unknown>(
  definition: PipelineDefinition,
  registry: StepRegistry = StepRegistry.withDefaults(),
): Pipeline<TInput, TOutput> {
  return registry.createPipeline<TInput, TOutput>(definition);
}

// ── Core ────────────────────────────────────────────────────────────────────
export { Pipeline } from './core/Pipeline';
export type { PipelineOptions, RunOptions } from './core/Pipeline';
export { PipelineBuilder } from './core/PipelineBuilder';
export type { AddOptions } from './core/PipelineBuilder';
export { PipelineContext } from './core/PipelineContext';
export { AbstractStep } from './core/AbstractStep';
export { CommandHistory } from './core/CommandHistory';
export type { HistoryEntry, RollbackReport } from './core/CommandHistory';
export { ContextMemento } from './core/ContextMemento';
export type { Step, AnyStep, StepInput, StepOutput } from './core/Step';
export type {
  PipelineResult,
  SuccessResult,
  FailureResult,
  HaltedResult,
} from './core/PipelineResult';
export {
  PipelineError,
  ValidationError,
  PipelineHaltedError,
  StepExecutionError,
  StepTimeoutError,
  NoRouteMatchedError,
  UnknownStepTypeError,
  InvalidDefinitionError,
} from './core/errors';
export type { ValidationIssue } from './core/errors';

// ── Events (Observer) ───────────────────────────────────────────────────────
export { PipelineEventBus } from './events/PipelineEventBus';
export type {
  PipelineEvent,
  PipelineEventType,
  PipelineObserver,
  ObserverLike,
} from './events/PipelineEventBus';
export { InMemoryAuditTrail } from './events/observers/InMemoryAuditTrail';
export { ConsoleAuditObserver, formatEvent } from './events/observers/ConsoleAuditObserver';
export type { LogFn } from './events/observers/ConsoleAuditObserver';
export { MetricsObserver } from './events/observers/MetricsObserver';
export type { MetricsSnapshot, StepMetrics } from './events/observers/MetricsObserver';

// ── Error strategies (Strategy) ─────────────────────────────────────────────
export type { ErrorStrategy, ErrorContext, ErrorDecision } from './strategies/ErrorStrategy';
export {
  FailFastStrategy,
  ContinueOnErrorStrategy,
  RollbackOnErrorStrategy,
  FallbackStrategy,
  failFast,
  continueOnError,
  rollbackOnError,
  fallbackTo,
} from './strategies/builtinStrategies';

// ── Ready-made steps ────────────────────────────────────────────────────────
export { ValidateStep } from './steps/ValidateStep';
export { FilterStep } from './steps/FilterStep';
export { EffectStep } from './steps/EffectStep';
export {
  MapEachStep,
  FilterEachStep,
  SortByStep,
  DedupeStep,
  ReduceStep,
} from './steps/collections';
export { PickStep, OmitStep, DefaultsStep, TrimStringsStep } from './steps/objects';
export { RouterStep } from './steps/composite/RouterStep';
export type { Route } from './steps/composite/RouterStep';
export { ParallelStep } from './steps/composite/ParallelStep';

// ── Decorators ──────────────────────────────────────────────────────────────
export { StepDecorator } from './decorators/StepDecorator';
export { RetryStep } from './decorators/RetryStep';
export type { RetryOptions } from './decorators/RetryStep';
export { TimeoutStep } from './decorators/TimeoutStep';
export { TimingStep, timingKey } from './decorators/TimingStep';
export { MemoizeStep } from './decorators/MemoizeStep';
export type { MemoizeOptions } from './decorators/MemoizeStep';
export { decorate } from './decorators/decorate';
export type { StepOptions } from './decorators/decorate';

// ── Validation rules ────────────────────────────────────────────────────────
export type { Rule, Schema } from './validation/rules';
export {
  required,
  isString,
  isNumber,
  isEmail,
  minLength,
  maxLength,
  range,
  matches,
  oneOf,
  custom,
} from './validation/rules';

// ── Adapter, registry and declarative pipelines ─────────────────────────────
export { FunctionStepAdapter, adaptFunction, asStep } from './adapters/FunctionStepAdapter';
export type { StepFunction, UndoFunction } from './adapters/FunctionStepAdapter';
export { StepRegistry } from './registry/StepRegistry';
export type {
  StepDefinition,
  PipelineDefinition,
  StepFactory,
  StrategyFactory,
} from './registry/StepRegistry';
export { evaluateCondition, readPath } from './registry/conditions';
export type { Condition, ConditionOp } from './registry/conditions';
export { ruleFromSpec } from './registry/ruleSpecs';
export type { RuleSpec } from './registry/ruleSpecs';
