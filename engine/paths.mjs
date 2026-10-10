// engine/paths.mjs
//
// Every `ref` in a registry is resolved relative to the code root and must
// stay inside it. A registry entry like "../../somewhere/else.mjs" is
// rejected instead of being imported or read.

import path from 'node:path';

export function resolveInside(codeRoot, ref) {
  if (typeof ref !== 'string' || !ref) {
    const error = new Error('Registry act has no "ref"');
    error.code = 'REF_MISSING';
    throw error;
  }
  const root = path.resolve(codeRoot);
  const resolved = path.resolve(root, ref);
  const relative = path.relative(root, resolved);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    const error = new Error(`ref "${ref}" points outside the code root`);
    error.code = 'REF_OUTSIDE_CODE_ROOT';
    throw error;
  }
  return resolved;
}
