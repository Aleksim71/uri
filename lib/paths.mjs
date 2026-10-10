// lib/paths.mjs
//
// Where handlers read configuration and exchange data. Scenarios exchange
// data through files in the artifacts directory, not through direct calls -
// see README "Data exchange between acts".
//
// URI_DATA_DIR / URI_CONFIG_DIR override the defaults (used by the tests).

import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const CODE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export function dataPath(fileName) {
  return path.resolve(process.env.URI_DATA_DIR ?? path.join(CODE_ROOT, 'artifacts'), fileName);
}

export function configPath(fileName) {
  return path.resolve(process.env.URI_CONFIG_DIR ?? path.join(CODE_ROOT, 'config'), fileName);
}
