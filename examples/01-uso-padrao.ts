/**
 * Caso de uso PADRÃO: tudo vem pronto, sem escrever nenhuma classe.
 * Cadastro de usuário: limpar → validar → normalizar → filtrar menores → registrar.
 */
import {
  ConsoleAuditObserver,
  createPipeline,
  isEmail,
  minLength,
  range,
  required,
} from 'pipeforge';

interface SignupForm {
  name: string;
  email: string;
  age: number;
  password?: string;
}

const signup = createPipeline<SignupForm>('signup')
  .observe(new ConsoleAuditObserver()) // auditoria pronta
  .trimStrings()
  .validate({
    name: [required(), minLength(2)],
    email: [required(), isEmail()],
    age: range(0, 120),
  })
  .map((form) => ({ ...form, email: form.email.toLowerCase() }), { name: 'normalize-email' })
  .filter((form) => form.age >= 18, 'menor de idade', { name: 'adults-only' })
  .omit('password')
  .map((form) => ({ ...form, id: `user-${form.email}` }), { name: 'assign-id', retry: 2 })
  .build();

async function main(): Promise<void> {
  console.log('\n--- 1) entrada válida ---');
  const ok = await signup.run({
    name: '  Ana  ',
    email: 'ANA@Example.com',
    age: 30,
    password: 'x',
  });
  if (ok.status === 'success') console.log('resultado:', ok.value);

  console.log('\n--- 2) entrada inválida (todos os erros de uma vez) ---');
  const invalid = await signup.run({ name: 'A', email: 'nao-e-email', age: 30 });
  if (invalid.status === 'failed')
    console.log('falhou em:', invalid.failedStep, '→', invalid.error.message);

  console.log('\n--- 3) filtro interrompe o fluxo (halt, não é erro) ---');
  const minor = await signup.run({ name: 'Bia', email: 'bia@example.com', age: 15 });
  if (minor.status === 'halted') console.log('interrompido em:', minor.haltedAt, '→', minor.reason);
}

main();
