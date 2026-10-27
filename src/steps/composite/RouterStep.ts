import { NoRouteMatchedError } from '../../core/errors';
import { Pipeline } from '../../core/Pipeline';
import type { PipelineContext } from '../../core/PipelineContext';
import type { Step } from '../../core/Step';

export interface Route<TInput = unknown, TOutput = unknown> {
  readonly name: string;
  /** Decides whether this route takes the input. */
  readonly when: (input: TInput, ctx: PipelineContext) => boolean | Promise<boolean>;
  /** What runs when the route is taken (a step, or a whole sub-pipeline). */
  readonly step: Step<TInput, TOutput>;
}

/** A step wrapped in a one-step pipeline gets events and rollback history like any other. */
export function asBranch<TInput, TOutput>(step: Step<TInput, TOutput>): Pipeline<TInput, TOutput> {
  return step instanceof Pipeline
    ? (step as Pipeline<TInput, TOutput>)
    : new Pipeline<TInput, TOutput>({ name: step.name, steps: [step] });
}

/**
 * @pattern Chain of Responsibility
 *
 * One link of the chain. It either handles the input (its route accepts it) or passes the
 * request to the next link, without knowing who that is. Adding a route never touches the
 * existing ones: it is just one more link at the end of the chain.
 */
class RouteHandler<TInput, TOutput> {
  private next?: RouteHandler<TInput, TOutput>;

  constructor(
    private readonly route: Route<TInput, TOutput>,
    private readonly branch: Pipeline<TInput, TOutput>,
  ) {}

  setNext(next: RouteHandler<TInput, TOutput>): RouteHandler<TInput, TOutput> {
    this.next = next;
    return next;
  }

  async handle(input: TInput, ctx: PipelineContext, routerName: string): Promise<TOutput> {
    if (await this.route.when(input, ctx)) {
      ctx.set(`route:${routerName}`, this.route.name);
      return this.branch.execute(input, ctx);
    }
    if (!this.next) throw new NoRouteMatchedError(routerName);
    return this.next.handle(input, ctx, routerName);
  }
}

/**
 * Sends each input down the first route whose `when` accepts it, or to `otherwise` when none
 * does. The route taken is stored in the context under `route:<routerName>`.
 */
export class RouterStep<TInput, TOutput> implements Step<TInput, TOutput> {
  private readonly head?: RouteHandler<TInput, TOutput>;

  constructor(
    readonly name: string,
    routes: readonly Route<TInput, TOutput>[],
    otherwise?: Step<TInput, TOutput>,
  ) {
    const allRoutes = otherwise
      ? [...routes, { name: 'otherwise', when: () => true, step: otherwise }]
      : routes;
    let tail: RouteHandler<TInput, TOutput> | undefined;
    for (const route of allRoutes) {
      const handler = new RouteHandler(route, asBranch(route.step));
      if (tail) tail.setNext(handler);
      else this.head = handler;
      tail = handler;
    }
  }

  async execute(input: TInput, ctx: PipelineContext): Promise<TOutput> {
    if (!this.head) throw new NoRouteMatchedError(this.name);
    return this.head.handle(input, ctx, this.name);
  }
}
