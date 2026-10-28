/**
 * Pipelines descritos como JSON (Factory Method + Registry). O cliente também registra
 * um tipo de step novo ("slugify") que passa a poder ser usado no JSON.
 */
import {
  AbstractStep,
  StepRegistry,
  createPipelineFromDefinition,
  type PipelineDefinition,
} from 'pipeforge';

class SlugifyStep extends AbstractStep<{ title: string }, { title: string; slug: string }> {
  constructor(private readonly separator: string) {
    super('slugify');
  }
  protected process(input: { title: string }) {
    return { ...input, slug: input.title.toLowerCase().replace(/\s+/g, this.separator) };
  }
}

const registry = StepRegistry.withDefaults().register<{ separator?: string }>(
  'slugify',
  (config) => new SlugifyStep(config.separator ?? '-'),
);

// Poderia vir de um arquivo .json, de um banco ou de uma API.
const definition: PipelineDefinition = {
  name: 'publish-article',
  errorStrategy: 'rollback-on-error',
  steps: [
    { type: 'trimStrings' },
    { type: 'validate', config: { rules: { title: ['required', { minLength: 5 }] } } },
    { type: 'slugify', config: { separator: '_' } },
    {
      type: 'route',
      config: {
        routes: [
          {
            name: 'draft',
            when: { field: 'status', op: 'eq', value: 'draft' },
            steps: [{ type: 'defaults', config: { values: { visibility: 'private' } } }],
          },
        ],
        otherwise: [{ type: 'defaults', config: { values: { visibility: 'public' } } }],
      },
    },
    { type: 'pick', config: { keys: ['slug', 'visibility'] } },
  ],
};

async function main(): Promise<void> {
  console.log('tipos disponíveis:', registry.types().join(', '));
  const pipeline = createPipelineFromDefinition(definition, registry);

  const draft = await pipeline.run({ title: '  Meu Primeiro Post  ', status: 'draft' });
  const published = await pipeline.run({ title: 'Design Patterns em TS', status: 'published' });
  const invalid = await pipeline.run({ title: 'oi' });

  console.log('rascunho  →', draft.ok ? draft.value : draft.status);
  console.log('publicado →', published.ok ? published.value : published.status);
  console.log('inválido  →', invalid.status);
}

main();
