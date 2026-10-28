/**
 * EXTENSÃO pelo cliente (Open/Closed): nenhum arquivo de src/ é alterado.
 * O cliente cria seus próprios: Step, Decorator, Observer, ErrorStrategy e Rule.
 */
import {
  AbstractStep,
  StepDecorator,
  createPipeline,
  type ErrorStrategy,
  type PipelineContext,
  type PipelineEvent,
  type PipelineObserver,
  type Rule,
  type Step,
} from 'pipeforge';

// 1) Step próprio (Template Method): só implementa process()
class SlugifyStep extends AbstractStep<{ title: string }, { title: string; slug: string }> {
  constructor() {
    super('slugify');
  }
  protected process(input: { title: string }) {
    const slug = input.title
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/(^-|-$)/g, '');
    return { ...input, slug };
  }
}

// 2) Decorator próprio: circuit breaker que envolve QUALQUER step
class CircuitBreaker<I, O> extends StepDecorator<I, O> {
  private failures = 0;
  constructor(
    inner: Step<I, O>,
    private readonly threshold: number,
  ) {
    super(inner, 'circuit');
  }
  override async execute(input: I, ctx: PipelineContext): Promise<O> {
    if (this.failures >= this.threshold) throw new Error('circuito aberto');
    try {
      return await this.inner.execute(input, ctx);
    } catch (error) {
      this.failures += 1;
      throw error;
    }
  }
}

// 3) Observer próprio: alerta quando um pipeline falha
class AlertObserver implements PipelineObserver {
  onEvent(event: PipelineEvent): void {
    if (event.type === 'pipeline:failed')
      console.log(`🚨 ALERTA [${event.pipeline}]: ${event.error.message}`);
  }
}

// 4) Estratégia de erro própria: ignora falhas "leves", aborta as demais
const tolerateMinor: ErrorStrategy = {
  name: 'tolerate-minor',
  handle: ({ error }) =>
    error.message.includes('leve') ? { action: 'skip' } : { action: 'abort' },
};

// 5) Regra de validação própria
const noSpaces: Rule<string> = (value) => (/\s/.test(value) ? 'não pode ter espaços' : null);

async function main(): Promise<void> {
  const post = await createPipeline<{ title: string }>('post')
    .add(new SlugifyStep())
    .build()
    .run({ title: 'Olá, Mundo Extensível!' });
  if (post.ok) console.log('slug:', post.value.slug);

  const flaky: Step<number, number> = {
    name: 'external-api',
    execute: () => {
      throw new Error('API fora do ar');
    },
  };
  const guarded = createPipeline<number>('guarded')
    .observe(new AlertObserver())
    .add(new CircuitBreaker(flaky, 1))
    .build();
  await guarded.run(1);
  const second = await guarded.run(1);
  if (!second.ok && second.status === 'failed') console.log('2ª chamada:', second.error.message);

  const lenient = await createPipeline<number>('lenient')
    .map(() => {
      throw new Error('falha leve');
    })
    .map((n) => n + 1)
    .onError(tolerateMinor)
    .build()
    .run(41);
  console.log('estratégia própria →', lenient.status);

  const username = await createPipeline<{ user: string }>('username')
    .validate({ user: noSpaces })
    .build()
    .run({ user: 'com espaço' });
  if (username.status === 'failed')
    console.log('regra própria →', (username.error as Error).message);
}

main();
