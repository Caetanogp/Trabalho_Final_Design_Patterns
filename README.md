# pipeforge

Micro-framework **extensível** para construir e executar **pipelines de processamento** de dados em
memória: validação, transformação, filtro, roteamento, ramos paralelos, **interrupção**,
**auditoria** e **rollback estruturado**. Escrito em TypeScript, sem dependências de runtime.

> Trabalho final de **Design Patterns** — biblioteca importável (pacote npm), não uma aplicação.
> Tema: opção D (Biblioteca de Construção de Pipelines de Processamento).

## Equipe

| Nome completo |
|---|
| Davi Henrique |
| Caetano Padoin |
| Matheus Brehm |

## Vídeo de apresentação

▶ [https://www.youtube.com/watch?v=aN3CqemTrJI](https://www.youtube.com/watch?v=aN3CqemTrJI)

## Sumário

- [Instalação](#instalação)
- [Início rápido](#início-rápido)
- [Conceitos](#conceitos)
- [Guia de uso](#guia-de-uso)
- [Como estender a biblioteca](#como-estender-a-biblioteca)
- [Padrões de projeto](#padrões-de-projeto)
- [Referência rápida da API](#referência-rápida-da-api)
- [Desenvolvimento](#desenvolvimento)

## Instalação

Requisitos: Node.js 20 ou superior.

```bash
# direto do repositório (GitHub)
npm install github:Caetanogp/Trabalho_Final_Design_Patterns

# ou a partir de um clone local
git clone https://github.com/Caetanogp/Trabalho_Final_Design_Patterns.git
cd Trabalho_Final_Design_Patterns && npm install && npm run build && npm pack
npm install ../caminho/para/pipeforge-1.0.0.tgz   # no projeto que vai usar a lib
```

A biblioteca é publicada em **ESM e CommonJS**, com tipos incluídos:

```ts
import { createPipeline } from 'pipeforge';          // ESM / TypeScript
const { createPipeline } = require('pipeforge');      // CommonJS
```

## Início rápido

```ts
import { createPipeline, required, isEmail, minLength } from 'pipeforge';

interface Signup { name: string; email: string; age: number; password?: string }

const signup = createPipeline<Signup>('signup')
  .trimStrings()
  .validate({ name: [required(), minLength(2)], email: [required(), isEmail()] })
  .map((form) => ({ ...form, email: form.email.toLowerCase() }))
  .filter((form) => form.age >= 18, 'menor de idade')
  .omit('password')
  .build();

const result = await signup.run({ name: ' Ana ', email: 'ANA@x.com', age: 30, password: '123' });

if (result.status === 'success') console.log(result.value);   // { name: 'Ana', email: 'ana@x.com', age: 30 }
if (result.status === 'failed') console.log(result.failedStep, result.error.message);
if (result.status === 'halted') console.log(result.haltedAt, result.reason);
```

`run()` **nunca lança** por causa de uma etapa: o resultado é sempre um objeto com `status`
(`'success' | 'failed' | 'halted'`), o tempo gasto e a **trilha de auditoria** (`result.audit`).
Prefere exceções? Use `await pipeline.runOrThrow(input)`.

## Conceitos

| Conceito | O que é |
|---|---|
| **Step** | Uma etapa: `execute(input, ctx)` e, opcionalmente, `compensate(input, output, ctx)` para desfazer. |
| **Pipeline** | Sequência de steps. Também é um `Step`, então pode ser aninhado em outro pipeline. |
| **Contexto** (`ctx`) | Estado compartilhado de **uma execução**: `ctx.get/set`, `ctx.metadata`, `ctx.halt(motivo)`. |
| **Halt** | Interrupção intencional (ex.: filtro). Não é erro: sem rollback, `status: 'halted'`. |
| **Estratégia de erro** | O que fazer quando um step falha: parar, ignorar, usar valor reserva ou desfazer tudo. |
| **Observer** | Quem recebe os eventos da execução (auditoria, logs, métricas, alertas). |

## Guia de uso

### Steps prontos (out-of-the-box)

| Método do builder | Step | O que faz |
|---|---|---|
| `.map(fn)` / `.use(fn)` | `FunctionStepAdapter` | Transforma o valor com uma função (síncrona ou `async`). |
| `.validate(schema)` | `ValidateStep` | Valida campos com regras; reporta **todos** os erros juntos. |
| `.filter(pred, motivo?)` | `FilterStep` | Deixa passar ou **interrompe** o fluxo (halt). |
| `.tap(efeito, desfazer?)` | `EffectStep` | Efeito colateral que repassa o valor; com `desfazer` é reversível. |
| `.pick(...chaves)` / `.omit(...chaves)` | `PickStep` / `OmitStep` | Mantém ou remove campos de um objeto. |
| `.defaults(valores)` | `DefaultsStep` | Preenche campos ausentes. |
| `.trimStrings()` | `TrimStringsStep` | Faz `trim` nos textos do objeto. |
| `.mapEach` `.filterEach` `.sortBy` `.dedupe` `.reduce` | `MapEachStep`... | Processamento de arrays. |
| `.route(rotas, padrão?)` | `RouterStep` | Roteia para o primeiro ramo cuja condição aceita o valor. |
| `.parallel({ a, b })` | `ParallelStep` | Executa ramos ao mesmo tempo; devolve `{ a, b }`. |
| `.add(step)` | qualquer `Step` | Adiciona um step seu ou um sub-pipeline. |

**Regras de validação prontas:** `required`, `isString`, `isNumber`, `isEmail`, `minLength`,
`maxLength`, `range`, `matches`, `oneOf` e `custom(predicado, mensagem)` (aceita `async`).

**Observers prontos:** `ConsoleAuditObserver`, `InMemoryAuditTrail`, `MetricsObserver`.

**Estratégias de erro prontas:** `failFast()` (padrão), `continueOnError()`, `rollbackOnError()`,
`fallbackTo(valor | (falha) => valor)`.

**Decorators prontos**, via opções de qualquer método do builder:

```ts
createPipeline<Order>()
  .map(callPaymentApi, { name: 'pay', retry: { retries: 3, delayMs: 200, backoff: 2 }, timeoutMs: 2000, timing: true })
  .map(findCustomer,   { memoize: { ttlMs: 60_000 } })
```

### Decisões de fluxo

```ts
// Roteamento (primeira rota que aceitar vence; a última é o padrão)
.route(
  [
    { name: 'urgent', when: (t) => t.priority === 'urgent', step: urgentSubPipeline },
    { name: 'high',   when: (t) => t.priority === 'high',   step: seniorTeamStep },
  ],
  defaultStep,
)

// Ramos paralelos: o resultado é { length: number, upper: string }
.parallel({ length: lengthStep, upper: upperStep })
```

### Rollback e auditoria

```ts
const checkout = createPipeline<Order>('checkout')
  .observe(new ConsoleAuditObserver())
  .tap(reserveStock, releaseStock)       // reversível
  .tap(chargeCard, refundCard)           // reversível
  .map(issueInvoice)                     // se falhar...
  .onError(rollbackOnError())            // ...desfaz refund e release, nessa ordem
  .build();

const result = await checkout.run(order);
if (result.status === 'failed') {
  result.rolledBack;           // true
  result.rollback?.compensated; // ['charge...', 'reserve...']  (ordem inversa)
  result.input;                // entrada original, restaurada
  result.audit;                // todos os eventos da execução
}
```

Cancelamento externo: `pipeline.run(input, { signal: abortController.signal })` interrompe antes da
próxima etapa. Dados do chamador chegam aos steps por `run(input, { metadata })` → `ctx.metadata`.

### Pipelines descritos em JSON

```ts
import { createPipelineFromDefinition } from 'pipeforge';

const pipeline = createPipelineFromDefinition({
  name: 'cadastro',
  errorStrategy: 'rollback-on-error',   // fail-fast | continue-on-error | rollback-on-error
  steps: [
    { type: 'trimStrings' },
    { type: 'validate', config: { rules: { email: ['required', 'email'], age: { range: [18, 99] } } } },
    { type: 'route', config: {
        routes: [{ when: { field: 'country', op: 'eq', value: 'BR' },
                   steps: [{ type: 'defaults', config: { values: { currency: 'BRL' } } }] }],
        otherwise: [{ type: 'defaults', config: { values: { currency: 'USD' } } }] } },
    { type: 'pick', config: { keys: ['email', 'currency'] }, retry: 2, timeoutMs: 500 },
  ],
});
```

Tipos disponíveis: `validate`, `pick`, `omit`, `defaults`, `trimStrings`, `filter`, `filterEach`,
`sortBy`, `dedupe`, `route`, `pipeline`. Operadores de condição: `eq neq gt gte lt lte in contains matches exists`.

## Como estender a biblioteca

Tudo abaixo é feito **no seu projeto**, criando classes novas, sem editar o código da biblioteca
(Open/Closed Principle). Exemplos completos e executáveis em [`examples/`](examples).

**1. Um step novo** — implemente só `process()` (Template Method):

```ts
import { AbstractStep } from 'pipeforge';

class SlugifyStep extends AbstractStep<{ title: string }, { title: string; slug: string }> {
  constructor() { super('slugify'); }
  protected process(input: { title: string }) {
    return { ...input, slug: input.title.toLowerCase().replace(/\s+/g, '-') };
  }
}
createPipeline<{ title: string }>().add(new SlugifyStep()).build();
```

Para steps com efeito externo, implemente também `compensate(input, output, ctx)` e eles passam a
participar do rollback. Ganchos opcionais: `validateInput`, `before`, `after`.

**2. Um decorator novo** (ex.: circuit breaker) — estenda `StepDecorator` e sobrescreva `execute`:

```ts
class CircuitBreaker<I, O> extends StepDecorator<I, O> {
  constructor(inner: Step<I, O>, private threshold: number) { super(inner, 'circuit'); }
  override async execute(input: I, ctx: PipelineContext) { /* ... */ return this.inner.execute(input, ctx); }
}
.add(new CircuitBreaker(apiStep, 3))
```

**3. Um observer novo** — qualquer objeto com `onEvent(event)` (ou apenas uma função):

```ts
.observe({ onEvent: (e) => { if (e.type === 'pipeline:failed') alertTeam(e.error); } })
```

**4. Uma estratégia de erro nova:**

```ts
const onlyRollbackOnPaymentErrors: ErrorStrategy = {
  name: 'payment-only',
  handle: ({ error }) => (error instanceof PaymentError ? { action: 'rollback' } : { action: 'abort' }),
};
.onError(onlyRollbackOnPaymentErrors)   // ações: abort | rollback | skip | { replace, value }
```

**5. Uma regra de validação nova** — uma função `(valor, campo) => mensagem | null`:

```ts
const isEven: Rule<number> = (v) => (v % 2 === 0 ? null : 'deve ser par');
.validate({ qty: isEven })
```

**6. Um tipo de step para pipelines JSON:**

```ts
const registry = StepRegistry.withDefaults()
  .register('slugify', (config) => new SlugifyStep())
  .registerStrategy('always-skip', () => ({ name: 'skip', handle: () => ({ action: 'skip' }) }));
const pipeline = createPipelineFromDefinition({ steps: [{ type: 'slugify' }] }, registry);
```

## Padrões de projeto

12 padrões aplicados, cada um resolvendo um problema concreto. Detalhes, diagramas e justificativas
em **[`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)**.

| Padrão | Onde |
|---|---|
| Builder | `src/core/PipelineBuilder.ts` |
| Composite | `src/core/Pipeline.ts`, `src/steps/composite/*` |
| Command | `src/core/Step.ts`, `src/core/CommandHistory.ts` |
| Memento | `src/core/ContextMemento.ts` |
| Observer | `src/events/*` |
| Decorator | `src/decorators/*` |
| Strategy | `src/strategies/*` |
| Template Method | `src/core/AbstractStep.ts` |
| Chain of Responsibility | `src/steps/composite/RouterStep.ts` |
| Factory Method + Registry | `src/registry/StepRegistry.ts` |
| Adapter | `src/adapters/FunctionStepAdapter.ts` |
| Facade | `src/index.ts` |

## Referência rápida da API

- `createPipeline<TInput>(nome?)` → `PipelineBuilder`
- `createPipelineFromDefinition(definição, registry?)` → `Pipeline`
- `pipeline.run(input, { metadata?, signal? })` → `Promise<PipelineResult>` (`success | failed | halted`)
- `pipeline.runOrThrow(input, opts?)` → valor, ou lança
- `PipelineResult`: `status`, `ok`, `value` (sucesso), `error` / `failedStep` / `rolledBack` / `rollback` / `input` (falha),
  `reason` / `haltedAt` / `input` (halt), além de `runId`, `pipeline`, `durationMs` e `audit`
- Eventos: `pipeline:start|success|failed|halted`, `step:start|success|error|skipped|fallback|halted|retry`,
  `rollback:start|step|end`
- Erros: `PipelineError` (base), `ValidationError`, `StepExecutionError`, `PipelineHaltedError`,
  `StepTimeoutError`, `NoRouteMatchedError`, `UnknownStepTypeError`, `InvalidDefinitionError`

## Desenvolvimento

```bash
npm install
npm run typecheck      # TypeScript estrito
npm run lint           # ESLint
npm test               # Vitest (102+ testes)
npm run test:coverage  # cobertura (>= 90%)
npm run build          # gera dist/ (ESM + CJS + .d.ts)
npm run examples       # roda os 5 exemplos de examples/
```

Estrutura: `src/` (biblioteca), `tests/` (testes), `examples/` (uso como cliente),
`docs/` (arquitetura e roteiro do vídeo).
