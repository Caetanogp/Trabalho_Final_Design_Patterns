import { AbstractStep } from '../core/AbstractStep';
import { ValidationError } from '../core/errors';
import type { PipelineContext } from '../core/PipelineContext';

/** Shared guard: every collection step needs an array as input. */
abstract class ArrayStep<TIn, TOut> extends AbstractStep<readonly TIn[], TOut> {
  protected override validateInput(input: readonly TIn[]): void {
    if (!Array.isArray(input)) {
      throw new ValidationError([{ field: '(root)', message: `${this.name} expects an array` }]);
    }
  }
}

/** Applies `fn` to every element (sequentially, keeping order). */
export class MapEachStep<T, U> extends ArrayStep<T, U[]> {
  constructor(
    private readonly fn: (item: T, index: number, ctx: PipelineContext) => U | Promise<U>,
    name = 'mapEach',
  ) {
    super(name);
  }

  protected override async process(input: readonly T[], ctx: PipelineContext): Promise<U[]> {
    const output: U[] = [];
    for (const [index, item] of input.entries()) output.push(await this.fn(item, index, ctx));
    return output;
  }
}

/** Keeps the elements for which `predicate` is true. An empty result is NOT a halt. */
export class FilterEachStep<T> extends ArrayStep<T, T[]> {
  constructor(
    private readonly predicate: (
      item: T,
      index: number,
      ctx: PipelineContext,
    ) => boolean | Promise<boolean>,
    name = 'filterEach',
  ) {
    super(name);
  }

  protected override async process(input: readonly T[], ctx: PipelineContext): Promise<T[]> {
    const output: T[] = [];
    for (const [index, item] of input.entries()) {
      if (await this.predicate(item, index, ctx)) output.push(item);
    }
    return output;
  }
}

/** Returns a sorted copy (the input array is never mutated). */
export class SortByStep<T> extends ArrayStep<T, T[]> {
  constructor(
    private readonly key: (item: T) => number | string,
    private readonly order: 'asc' | 'desc' = 'asc',
    name = 'sortBy',
  ) {
    super(name);
  }

  protected override process(input: readonly T[]): T[] {
    const direction = this.order === 'asc' ? 1 : -1;
    return [...input].sort((a, b) => {
      const left = this.key(a);
      const right = this.key(b);
      return left < right ? -direction : left > right ? direction : 0;
    });
  }
}

/** Removes duplicates, keeping the first occurrence of each key. */
export class DedupeStep<T> extends ArrayStep<T, T[]> {
  constructor(
    private readonly key: (item: T) => unknown = (item) => item,
    name = 'dedupe',
  ) {
    super(name);
  }

  protected override process(input: readonly T[]): T[] {
    const seen = new Set<unknown>();
    return input.filter((item) => {
      const k = this.key(item);
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
  }
}

/** Folds the array into a single value. */
export class ReduceStep<T, A> extends ArrayStep<T, A> {
  constructor(
    private readonly reducer: (accumulator: A, item: T, index: number) => A,
    private readonly initial: A,
    name = 'reduce',
  ) {
    super(name);
  }

  protected override process(input: readonly T[]): A {
    return input.reduce(this.reducer, this.initial);
  }
}
