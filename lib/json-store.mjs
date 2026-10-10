// lib/json-store.mjs

import fs from 'node:fs/promises';
import path from 'node:path';

export async function readJsonSafe(filePath, fallback) {
  try {
    return JSON.parse(await fs.readFile(filePath, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') return fallback;
    throw error;
  }
}

// Write to a temp file and rename it over the target, so a crash in the
// middle of a write never leaves a half-written JSON file behind.
export async function writeJsonAtomic(filePath, value) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const tmpPath = `${filePath}.${process.pid}.tmp`;
  await fs.writeFile(tmpPath, JSON.stringify(value, null, 2), 'utf8');
  await fs.rename(tmpPath, filePath);
}
