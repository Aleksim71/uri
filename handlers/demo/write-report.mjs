// handlers/demo/write-report.mjs
//
// A "real task" stand-in: writes an artifact. Acts exchange data through
// shared files with agreed names, not by calling each other directly.

import { writeJsonAtomic } from '../../lib/json-store.mjs';
import { dataPath } from '../../lib/paths.mjs';

export async function execute({ act }) {
  const outputPath = dataPath('report.json');
  await writeJsonAtomic(outputPath, {
    generatedAt: new Date().toISOString(),
    trigger: act.trigger,
    note: 'Placeholder. This is where an LLM call or a real script would go.'
  });
  console.log(`[write-report] report written to ${outputPath}`);
  return { outputPath };
}
