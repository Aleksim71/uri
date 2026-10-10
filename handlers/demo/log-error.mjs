// handlers/demo/log-error.mjs
//
// Example onError hook. The engine knows nothing about what it does - it
// just runs the trigger named in the scenario's "onError". Whether to log,
// notify or retry is decided here, by an ordinary registry act.

import fs from 'node:fs/promises';
import path from 'node:path';
import { dataPath } from '../../lib/paths.mjs';

export async function execute({ context }) {
  const outputPath = dataPath('error.log');
  await fs.mkdir(path.dirname(outputPath), { recursive: true });

  const line = `${new Date().toISOString()} ${context?.reasonCode ?? 'UNKNOWN'} ${context?.message ?? ''}\n`;
  await fs.appendFile(outputPath, line, 'utf8');
  console.log(`[log-error] logged to ${outputPath}`);
  return { logged: true };
}
