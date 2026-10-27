/**
 * A validation rule inspects one field and returns an error message, or `null` when the value
 * is acceptable. Rules may be async (e.g. "is this e-mail already registered?").
 * Writing your own rule is just writing a function with this shape.
 */
export type Rule<TValue = unknown> = (
  value: TValue,
  field: string,
) => string | null | Promise<string | null>;

/** Maps fields of `T` to one rule or a list of rules. Fields without an entry are not checked. */
export type Schema<T> = { [K in keyof T]?: Rule<T[K]> | readonly Rule<T[K]>[] };

const isEmpty = (value: unknown): boolean =>
  value === undefined ||
  value === null ||
  (typeof value === 'string' && value.trim() === '') ||
  (Array.isArray(value) && value.length === 0);

/**
 * Rules other than `required` accept empty values on purpose, so optional fields can still
 * carry format rules. Combine with `required()` to make a field mandatory.
 */
export const required =
  (message = 'is required'): Rule =>
  (value) =>
    isEmpty(value) ? message : null;

export const isString =
  (message = 'must be a string'): Rule =>
  (value) =>
    isEmpty(value) || typeof value === 'string' ? null : message;

export const isNumber =
  (message = 'must be a number'): Rule =>
  (value) =>
    isEmpty(value) || (typeof value === 'number' && Number.isFinite(value)) ? null : message;

export const isEmail =
  (message = 'must be a valid e-mail'): Rule =>
  (value) =>
    isEmpty(value) || (typeof value === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value))
      ? null
      : message;

export const minLength =
  (min: number, message = `must have at least ${min} characters`): Rule =>
  (value) =>
    isEmpty(value) || (typeof value === 'string' && value.length >= min) ? null : message;

export const maxLength =
  (max: number, message = `must have at most ${max} characters`): Rule =>
  (value) =>
    isEmpty(value) || (typeof value === 'string' && value.length <= max) ? null : message;

export const range =
  (min: number, max: number, message = `must be between ${min} and ${max}`): Rule =>
  (value) =>
    isEmpty(value) || (typeof value === 'number' && value >= min && value <= max) ? null : message;

export const matches =
  (pattern: RegExp, message = `must match ${pattern}`): Rule =>
  (value) =>
    isEmpty(value) || (typeof value === 'string' && new RegExp(pattern).test(value))
      ? null
      : message;

export const oneOf =
  (allowed: readonly unknown[], message = `must be one of: ${allowed.join(', ')}`): Rule =>
  (value) =>
    isEmpty(value) || allowed.includes(value) ? null : message;

/** Turns any predicate into a rule. */
export const custom =
  <TValue = unknown>(
    predicate: (value: TValue) => boolean | Promise<boolean>,
    message: string,
  ): Rule<TValue> =>
  async (value) =>
    (await predicate(value)) ? null : message;
