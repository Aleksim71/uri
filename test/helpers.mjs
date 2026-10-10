// test/helpers.mjs
//
// Builds a throw-away code root with its own registries, scenarios and
// handlers, so engine tests do not depend on the demo files.

import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

export async function makeCodeRoot({ acts, files = {} }) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'uri-test-'));
  const write = async (relative, content) => {
    const full = path.join(root, relative);
    await fs.mkdir(path.dirname(full), { recursive: true });
    await fs.writeFile(full, typeof content === 'string' ? content : JSON.stringify(content, null, 2));
  };
  await write('registries/registry.json', {
    registries: [{ registry: 'test', registryRef: 'registries/test.registry.json' }]
  });
  await write('registries/test.registry.json', { acts });
  for (const [relative, content] of Object.entries(files)) await write(relative, content);
  return root;
}

export const handlers = {
  ok: 'export async function execute() { return { ok: true }; }',
  fail: `export async function execute() {
    const error = new Error('boom');
    error.code = 'TEST_FAILURE';
    throw error;
  }`,
  // records every call (and the context it got) into globalThis.__calls
  record: `export async function execute({ act, context }) {
    (globalThis.__calls ??= []).push({ trigger: act.trigger, context });
    return {};
  }`
};

export async function makeTempDir(prefix = 'uri-data-') {
  return fs.mkdtemp(path.join(os.tmpdir(), prefix));
}
