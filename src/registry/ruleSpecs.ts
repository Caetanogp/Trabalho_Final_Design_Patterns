import { InvalidDefinitionError } from '../core/errors';
import {
  isEmail,
  isNumber,
  isString,
  matches,
  maxLength,
  minLength,
  oneOf,
  range,
  required,
} from '../validation/rules';
import type { Rule } from '../validation/rules';

/** JSON-friendly description of a rule: `"required"`, `{ "minLength": 3 }`, ... */
export type RuleSpec =
  | 'required'
  | 'email'
  | 'string'
  | 'number'
  | { readonly minLength: number }
  | { readonly maxLength: number }
  | { readonly range: readonly [number, number] }
  | { readonly matches: string }
  | { readonly oneOf: readonly unknown[] };

/** Rules written as a plain name. */
const NAMED_RULES: Record<string, () => Rule> = {
  required: () => required(),
  email: () => isEmail(),
  string: () => isString(),
  number: () => isNumber(),
};

export function ruleFromSpec(spec: RuleSpec): Rule {
  if (typeof spec === 'string') {
    const create = Object.hasOwn(NAMED_RULES, spec) ? NAMED_RULES[spec] : undefined;
    if (!create) throw new InvalidDefinitionError(`Unknown validation rule "${spec}"`);
    return create();
  }
  if ('minLength' in spec) return minLength(spec.minLength);
  if ('maxLength' in spec) return maxLength(spec.maxLength);
  if ('range' in spec) return range(spec.range[0], spec.range[1]);
  if ('matches' in spec) return matches(new RegExp(spec.matches));
  if ('oneOf' in spec) return oneOf(spec.oneOf);
  throw new InvalidDefinitionError(`Unknown validation rule ${JSON.stringify(spec)}`);
}
