import { AbstractStep } from '../core/AbstractStep';
import { ValidationError } from '../core/errors';
import type { ValidationIssue } from '../core/errors';
import type { Rule, Schema } from '../validation/rules';

/**
 * Checks an object against a `Schema` and passes it through untouched. All broken rules are
 * collected into a single `ValidationError` so the caller sees every problem at once.
 */
export class ValidateStep<T extends object> extends AbstractStep<T, T> {
  constructor(
    private readonly schema: Schema<T>,
    name = 'validate',
  ) {
    super(name);
  }

  protected override validateInput(input: T): void {
    if (input === null || typeof input !== 'object') {
      throw new ValidationError([{ field: '(root)', message: 'must be an object' }]);
    }
  }

  protected override async process(input: T): Promise<T> {
    const issues: ValidationIssue[] = [];
    for (const field of Object.keys(this.schema) as (keyof T & string)[]) {
      const entry = this.schema[field] as
        Rule<T[keyof T]> | readonly Rule<T[keyof T]>[] | undefined;
      const rules = Array.isArray(entry) ? entry : entry ? [entry as Rule<T[keyof T]>] : [];
      for (const rule of rules) {
        const message = await rule(input[field], field);
        if (message) issues.push({ field, message });
      }
    }
    if (issues.length > 0) throw new ValidationError(issues);
    return input;
  }
}
