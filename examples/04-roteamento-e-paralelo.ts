/**
 * Fluxos complexos: roteamento condicional (Chain of Responsibility), ramos em paralelo,
 * sub-pipelines (Composite) e processamento de coleções.
 */
import { createPipeline, type Step } from 'pipeforge';

interface Ticket {
  id: number;
  priority: 'low' | 'high' | 'urgent';
  text: string;
}

const handler = (label: string): Step<Ticket, string> => ({
  name: label,
  execute: (t) => `#${t.id} → ${label}`,
});

// Sub-pipeline reaproveitável: é um Step como qualquer outro (Composite)
const urgentFlow = createPipeline<Ticket>('urgent-flow')
  .map((t) => ({ ...t, text: t.text.toUpperCase() }))
  .map((t) => `#${t.id} → plantão acionado: ${t.text}`)
  .build();

const triage = createPipeline<Ticket>('triage')
  .route(
    [
      { name: 'urgent', when: (t) => t.priority === 'urgent', step: urgentFlow },
      { name: 'high', when: (t) => t.priority === 'high', step: handler('equipe sênior') },
    ],
    handler('fila padrão'),
  )
  .build();

const enrich = createPipeline<string>('enrich')
  .parallel({
    length: { name: 'length', execute: (s: string) => s.length },
    words: { name: 'words', execute: (s: string) => s.split(/\s+/).length },
    upper: { name: 'upper', execute: async (s: string) => s.toUpperCase() },
  })
  .build();

const report = createPipeline<Ticket[]>('report')
  .dedupe((t) => t.id)
  .filterEach((t) => t.priority !== 'low')
  .sortBy((t) => t.id, 'desc')
  .mapEach((t) => `${t.id}:${t.priority}`)
  .build();

async function main(): Promise<void> {
  for (const ticket of [
    { id: 1, priority: 'low', text: 'dúvida' },
    { id: 2, priority: 'high', text: 'erro no login' },
    { id: 3, priority: 'urgent', text: 'sistema fora do ar' },
  ] as Ticket[]) {
    const result = await triage.run(ticket);
    if (result.ok) console.log(result.value);
  }

  const parallel = await enrich.run('pipelines são úteis');
  if (parallel.ok) console.log('\nparalelo:', parallel.value);

  const summary = await report.run([
    { id: 1, priority: 'low', text: '' },
    { id: 2, priority: 'high', text: '' },
    { id: 2, priority: 'high', text: '' },
    { id: 3, priority: 'urgent', text: '' },
  ]);
  if (summary.ok) console.log('\ncoleção:', summary.value);
}

main();
