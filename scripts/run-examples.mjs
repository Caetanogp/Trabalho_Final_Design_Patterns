// Runs every file in examples/ with tsx and stops at the first failure.
import { readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';

const dir = new URL('../examples/', import.meta.url);
const files = readdirSync(dir)
  .filter((file) => file.endsWith('.ts'))
  .sort();

for (const file of files) {
  console.log(`\n${'='.repeat(70)}\n▶ ${file}\n${'='.repeat(70)}`);
  const result = spawnSync('npx', ['tsx', join('examples', file)], {
    stdio: 'inherit',
    shell: true,
  });
  if (result.status !== 0) {
    console.error(`\n✖ ${file} failed (exit ${result.status})`);
    process.exit(result.status ?? 1);
  }
}
console.log('\n✔ all examples ran successfully');
