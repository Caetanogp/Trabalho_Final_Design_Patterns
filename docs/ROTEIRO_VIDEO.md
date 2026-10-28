# Roteiro do vídeo de apresentação (pipeforge)

Sugestão de duração total: **10 a 12 minutos**. Integrantes: Davi Henrique, Caetano Padoin e Matheus Brehm.
Cada aluno defende os padrões do **lote de commits que ele mesmo enviou** (veja a divisão na seção 3);
se preferirem trocar, basta combinar entre vocês.

## 1. Visão geral (≈ 1 min) — Aluno do Lote 1
- A biblioteca: **pipeforge**, micro-framework de pipelines de processamento em memória (TypeScript, pacote npm).
- O problema: encadear validação, transformação, filtro e roteamento em uma função gigante gera
  código acoplado, sem tratamento uniforme de erros, sem como **desfazer** o que já foi feito e sem
  **auditoria**.
- A solução: cada etapa é um `Step` independente; o `Pipeline` conduz o fluxo; falha, rollback,
  auditoria e extensão são tratados de forma uniforme.
- Mostrar o README e a estrutura de pastas em 20 segundos.

## 2. Uso prático (≈ 2 a 3 min) — Aluno do Lote 2 (padrão) e Aluno do Lote 3 (extensão)

### 2.1 Caso padrão (Lote 2) — `npx tsx examples/01-uso-padrao.ts`
1. Mostrar `import { createPipeline, required, isEmail, ... } from 'pipeforge'`.
2. Montar o pipeline de cadastro (`trimStrings → validate → map → filter → omit → map`) e rodar.
3. Mostrar as três saídas: sucesso, falha de validação (todos os erros juntos) e **halt** do filtro.
4. Mostrar o rollback: `examples/03-rollback-auditoria.ts` (estoque e saldo voltando ao valor original).

### 2.2 Cliente estendendo a lib (Lote 3) — `examples/02-extensao-custom-step.ts`
1. Abrir o arquivo e destacar que **nenhum arquivo de `src/` é alterado**.
2. Mostrar as cinco extensões: `SlugifyStep` (Template Method), `CircuitBreaker` (Decorator),
   `AlertObserver` (Observer), `tolerateMinor` (Strategy) e `noSpaces` (regra de validação).
3. Rodar e mostrar a saída.
4. Bônus (15 s): `examples/05-pipeline-via-json.ts`, com um tipo `'slugify'` registrado e usado em JSON.

## 3. Defesa arquitetural (≈ 2 min por padrão) — cada aluno apresenta 2 padrões

Para **cada** padrão: (1) qual é, (2) onde está (mostrar o código), (3) qual problema de design
resolveu aqui, (4) por que foi a escolha adequada. A tabela completa está em `docs/ARCHITECTURE.md`.

### Aluno do Lote 1 (núcleo do motor)
**Command** — `src/core/Step.ts` e `src/core/CommandHistory.ts`
- Problema: desfazer os efeitos das etapas já concluídas quando uma tardia falha.
- Mostrar: `execute`/`compensate` na interface `Step` e `rollbackTo` desempilhando em ordem inversa.
- Demonstração: `examples/03-rollback-auditoria.ts` (`rollback:step charge-card`, depois `reserve-stock`).

**Memento** — `src/core/ContextMemento.ts` e `PipelineContext.createMemento/restore`
- Problema: o rollback externo não restaura o estado em memória (entrada original e estado compartilhado).
- Mostrar: snapshot imutável e clonado, e o símbolo `MEMENTO_STATE` não exportado, que garante o
  encapsulamento (o caretaker `Pipeline` não lê o conteúdo).
- Demonstração: `result.input` restaurado no exemplo 03.

### Aluno do Lote 2 (motor de execução e passos prontos)
**Composite** — `src/core/Pipeline.ts` (`class Pipeline implements Step`)
- Problema: sub-fluxos e ramos sem `if (é pipeline)` espalhado.
- Mostrar: `Pipeline` implementa `Step`, e o `RouterStep` executa um sub-pipeline como se fosse um step comum.
- Demonstração: `examples/04-roteamento-e-paralelo.ts` (`urgentFlow` dentro do roteador).

**Decorator** — `src/decorators/StepDecorator.ts`, `RetryStep.ts`, `decorate.ts`
- Problema: retry, timeout, tempo e cache sem explosão de subclasses.
- Mostrar: `StepDecorator` envolve um `Step` e é um `Step`; `decorate()` empilha
  (`memoize(timing(retry(timeout(step))))`); o `CircuitBreaker` do cliente reaproveita a mesma base.
- Demonstração: `.map(fn, { retry: 2, timeoutMs: 500 })` e o nome `retry(timeout(...))` nos eventos.

### Aluno do Lote 3 (API de uso)
**Builder** — `src/core/PipelineBuilder.ts`
- Problema: montar pipeline com várias etapas, decorators, estratégia e observers sem construtor gigante.
- Mostrar: métodos que devolvem **novo** builder (imutável) e os genéricos `PipelineBuilder<TInput, TOutput>`
  (o compilador barra um `.map` que espera `string` depois de uma etapa que devolve `number`).
- Demonstração: `const base = createPipeline<number>().map(...)` reaproveitado em duas variantes (teste em `tests/extensibility.test.ts`).

**Factory Method + Registry** — `src/registry/StepRegistry.ts`
- Problema: criar steps por **nome** (pipelines descritos em JSON) sem que a lista de tipos fique fixa no código.
- Mostrar: `register(tipo, factory)` e `create(definição)`; o cliente registra o tipo `'slugify'` e o usa em JSON.
- Demonstração: `examples/05-pipeline-via-json.ts`.

## 4. Encerramento (≈ 30 s) — todos
- Lembrar o OCP: tudo que o cliente precisou estender foi feito criando classes novas.
- Padrões de reserva, se perguntarem: Observer, Strategy, Template Method, Chain of Responsibility,
  Adapter e Facade (12 no total).
- Mostrar `npm test` (102+ testes) e a cobertura.

## Checklist antes de gravar
- [ ] `npm install && npm test && npm run build` sem erros.
- [ ] README com os **nomes completos** e o **link do vídeo** preenchidos.
- [ ] Vídeo no YouTube (pode ser "Não listado").
- [ ] Cada aluno apareceu e falou; cada um mostrou o código de 2 padrões.
