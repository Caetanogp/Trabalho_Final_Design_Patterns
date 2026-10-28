import { InvalidDefinitionError } from '../core/errors';

export type ConditionOp =
  'eq' | 'neq' | 'gt' | 'gte' | 'lt' | 'lte' | 'in' | 'contains' | 'matches' | 'exists';

/** A serialisable predicate, so pipelines described as JSON can filter and route. */
export interface Condition {
  /** Dotted path into the value, e.g. `"address.country"`. Empty means the value itself. */
  readonly field?: string;
  readonly op: ConditionOp;
  readonly value?: unknown;
}

const isText = (value: unknown): value is string => typeof value === 'string';

/** One small function per operator: adding an operator means adding one line here. */
const OPERATORS: Record<ConditionOp, (actual: unknown, expected: unknown) => boolean> = {
  eq: (actual, expected) => actual === expected,
  neq: (actual, expected) => actual !== expected,
  gt: (actual, expected) => (actual as number) > (expected as number),
  gte: (actual, expected) => (actual as number) >= (expected as number),
  lt: (actual, expected) => (actual as number) < (expected as number),
  lte: (actual, expected) => (actual as number) <= (expected as number),
  in: (actual, expected) => Array.isArray(expected) && expected.includes(actual),
  contains: (actual, expected) =>
    isText(actual)
      ? isText(expected) && actual.includes(expected)
      : Array.isArray(actual) && actual.includes(expected),
  matches: (actual, expected) => isText(actual) && new RegExp(String(expected)).test(actual),
  exists: (actual) => actual !== undefined && actual !== null,
};

export function readPath(subject: unknown, path = ''): unknown {
  if (path === '') return subject;
  return path.split('.').reduce<unknown>((current, key) => {
    return current !== null && typeof current === 'object'
      ? (current as Record<string, unknown>)[key]
      : undefined;
  }, subject);
}

export function evaluateCondition(condition: Condition, subject: unknown): boolean {
  if (!Object.hasOwn(OPERATORS, condition.op)) {
    throw new InvalidDefinitionError(`Unknown condition operator "${String(condition.op)}"`);
  }
  return OPERATORS[condition.op](readPath(subject, condition.field), condition.value);
}
