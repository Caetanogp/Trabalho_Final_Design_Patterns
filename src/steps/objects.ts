import { AbstractStep } from '../core/AbstractStep';

type PlainObject = Record<string, unknown>;

/** Keeps only the listed keys. */
export class PickStep<T extends object, K extends keyof T> extends AbstractStep<T, Pick<T, K>> {
  constructor(
    private readonly keys: readonly K[],
    name = 'pick',
  ) {
    super(name);
  }

  protected override process(input: T): Pick<T, K> {
    const output = {} as Pick<T, K>;
    for (const key of this.keys) if (key in input) output[key] = input[key];
    return output;
  }
}

/** Removes the listed keys. */
export class OmitStep<T extends object, K extends keyof T> extends AbstractStep<T, Omit<T, K>> {
  constructor(
    private readonly keys: readonly K[],
    name = 'omit',
  ) {
    super(name);
  }

  protected override process(input: T): Omit<T, K> {
    const output: PlainObject = { ...(input as PlainObject) };
    for (const key of this.keys) delete output[key as string];
    return output as Omit<T, K>;
  }
}

/** Fills in missing (`undefined`/`null`) fields with default values. */
export class DefaultsStep<T extends object> extends AbstractStep<T, T> {
  constructor(
    private readonly values: Partial<T>,
    name = 'defaults',
  ) {
    super(name);
  }

  protected override process(input: T): T {
    const output: PlainObject = { ...(input as PlainObject) };
    for (const [key, value] of Object.entries(this.values)) {
      if (output[key] === undefined || output[key] === null) output[key] = value;
    }
    return output as T;
  }
}

/** Trims every top-level string field. */
export class TrimStringsStep<T extends object> extends AbstractStep<T, T> {
  constructor(name = 'trimStrings') {
    super(name);
  }

  protected override process(input: T): T {
    const output: PlainObject = {};
    for (const [key, value] of Object.entries(input)) {
      output[key] = typeof value === 'string' ? value.trim() : value;
    }
    return output as T;
  }
}
