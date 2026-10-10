// run.mjs
//
// Entry point. Usage:
//   node run.mjs scenarios/demo/scenario.json
// Exit code: 0 if the scenario completed, 1 otherwise.

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Interpreter } from './engine/interpreter.mjs';

const CODE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)));

try {
  process.loadEnvFile(path.resolve(CODE_ROOT, '.env'));
} catch {
  // .env is optional (demo scenarios need no tokens)
}

async function main() {
  const scenarioArg = process.argv[2] ?? 'scenarios/demo/scenario.json';
  const scenario = JSON.parse(await fs.readFile(path.resolve(CODE_ROOT, scenarioArg), 'utf8'));

  const interpreter = new Interpreter({ codeRoot: CODE_ROOT });
  const result = await interpreter.run(scenario);

  console.log('\n=== Result ===');
  console.log(JSON.stringify(result, null, 2));
  process.exitCode = result.outcome === 'completed' ? 0 : 1;
}

main().catch((error) => {
  // Only reached for problems outside a scenario (e.g. unreadable scenario file).
  console.error('Fatal:', error);
  process.exitCode = 1;
});
