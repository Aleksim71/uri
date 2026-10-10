// engine/registry.mjs
//
// Registries work like a CSS cascade: registries/registry.json lists the
// connected registries in order. A trigger is looked up in each registry
// from top to bottom and the first match wins. Inside one registry an exact
// match beats a wildcard route.
//
// Wildcard routes: an entry like node("*") matches ANY arguments of the same
// domain - node("--version") as well as node("a", "b"). This is routing, not
// a security boundary: node("*") also allows node("-e", "<any code>").
// Scenarios and registries are treated as trusted input. A real deny-list /
// sandbox belongs to the phase where the engine executes untrusted input
// (see README, "Deliberately not implemented").

import fs from 'node:fs/promises';
import { parseTrigger, canonicalTrigger } from './trigger.mjs';
import { resolveInside } from './paths.mjs';

async function readJson(filePath) {
  return JSON.parse(await fs.readFile(filePath, 'utf8'));
}

function isWildcardRoute(parsed) {
  return parsed.arguments.length === 1 && parsed.arguments[0] === '*';
}

// Reads the index and every connected registry once. The result is a plain
// array that resolveTrigger() can search without touching the disk.
export async function loadRegistries({ indexPath, codeRoot }) {
  const index = await readJson(indexPath);
  if (!Array.isArray(index.registries)) {
    const error = new Error('Registry index must contain a "registries" array');
    error.code = 'REGISTRY_INDEX_INVALID';
    throw error;
  }

  const loaded = [];
  for (const entry of index.registries) {
    const registryPath = resolveInside(codeRoot, entry.registryRef);
    const registry = await readJson(registryPath);
    const acts = [];
    for (const act of registry.acts ?? []) {
      let parsed;
      try {
        parsed = parseTrigger(act.trigger);
      } catch {
        continue; // a malformed entry never matches anything
      }
      acts.push({ act, parsed, canonical: canonicalTrigger(parsed), wildcard: isWildcardRoute(parsed) });
    }
    loaded.push({ name: entry.registry, acts });
  }
  return loaded;
}

// Registry act: { trigger, kind: 'atom' | 'list', ref, description }
//   atom - ref points to an .mjs module exporting async execute()
//   list - ref points to a .json scenario (a nested list of acts)
export function resolveTrigger({ trigger, registries }) {
  let requested;
  try {
    requested = parseTrigger(trigger);
  } catch (error) {
    return { status: 'invalid', error: { code: error.code, message: error.message } };
  }
  const requestedCanonical = canonicalTrigger(requested);

  for (const registry of registries) {
    let wildcardMatch = null;
    for (const entry of registry.acts) {
      if (entry.canonical === requestedCanonical) {
        return { status: 'resolved', registryAct: entry.act, registry: registry.name, parsedTrigger: requested };
      }
      if (!wildcardMatch && entry.wildcard && entry.parsed.domain === requested.domain) {
        wildcardMatch = entry.act;
      }
    }
    if (wildcardMatch) {
      return { status: 'resolved', registryAct: wildcardMatch, registry: registry.name, parsedTrigger: requested };
    }
  }

  return {
    status: 'not-found',
    error: {
      code: 'TRIGGER_NOT_FOUND',
      message: `Trigger not registered in any connected registry: ${requestedCanonical}`
    }
  };
}
