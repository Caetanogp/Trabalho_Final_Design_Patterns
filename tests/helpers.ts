import type { AnyStep, PipelineContext, Step } from '../src';

/** A reversible step that logs what it did and what it undid. */
export function loggedStep(
  name: string,
  log: string[],
  options: { fail?: boolean; reversible?: boolean } = {},
): Step<number, number> {
  const { fail = false, reversible = true } = options;
  const step: Step<number, number> = {
    name,
    execute: (input: number) => {
      if (fail) throw new Error(`${name} exploded`);
      log.push(`do:${name}`);
      return input + 1;
    },
  };
  if (reversible) {
    step.compensate = () => {
      log.push(`undo:${name}`);
    };
  }
  return step;
}

export const double: AnyStep = { name: 'double', execute: (n: number) => n * 2 };

export const withCtx = (fn: (ctx: PipelineContext) => void): AnyStep => ({
  name: 'ctx',
  execute: (value: unknown, ctx: PipelineContext) => {
    fn(ctx);
    return value;
  },
});
