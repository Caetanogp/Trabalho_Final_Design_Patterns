/**
 * Rollback estruturado (Command + Memento) com trilha de auditoria (Observer).
 * Um pedido reserva estoque, cobra o cartão e então falha ao emitir a nota → tudo é desfeito
 * na ordem inversa.
 */
import { ConsoleAuditObserver, MetricsObserver, createPipeline, rollbackOnError } from 'pipeforge';

const stock = new Map([['camiseta', 5]]);
const wallet = { balance: 100 };

interface Order {
  item: string;
  qty: number;
  price: number;
}

const metrics = new MetricsObserver();

const checkout = createPipeline<Order>('checkout')
  .observe(new ConsoleAuditObserver())
  .observe(metrics)
  .tap(
    (order) => void stock.set(order.item, (stock.get(order.item) ?? 0) - order.qty),
    (order) => void stock.set(order.item, (stock.get(order.item) ?? 0) + order.qty),
    { name: 'reserve-stock' },
  )
  .tap(
    (order) => void (wallet.balance -= order.price),
    (order) => void (wallet.balance += order.price),
    { name: 'charge-card' },
  )
  .map(
    () => {
      throw new Error('serviço de nota fiscal indisponível');
    },
    { name: 'issue-invoice' },
  )
  .onError(rollbackOnError())
  .build();

async function main(): Promise<void> {
  console.log('antes   → estoque:', stock.get('camiseta'), '| saldo:', wallet.balance);

  const result = await checkout.run({ item: 'camiseta', qty: 2, price: 60 });

  console.log('depois  → estoque:', stock.get('camiseta'), '| saldo:', wallet.balance);
  if (result.status === 'failed') {
    console.log('\nstatus:', result.status, '| falhou em:', result.failedStep);
    console.log('desfeito (ordem inversa):', result.rollback?.compensated);
    console.log('entrada restaurada pelo Memento:', result.input);
    console.log('eventos na auditoria:', result.audit.length);
  }
  console.log('\nmétricas:', JSON.stringify(metrics.snapshot(), null, 2));
}

main();
