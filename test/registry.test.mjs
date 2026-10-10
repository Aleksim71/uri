import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { loadRegistries, resolveTrigger } from '../engine/registry.mjs';
import { makeCodeRoot } from './helpers.mjs';

async function twoRegistries() {
  const root = await makeCodeRoot({
    acts: [
      { trigger: 'node("*")', kind: 'atom', ref: 'h/wild.mjs' },
      { trigger: 'node("--version")', kind: 'atom', ref: 'h/exact.mjs' }
    ]
  });
  await fs.writeFile(path.join(root, 'registries/second.registry.json'), JSON.stringify({
    acts: [
      { trigger: 'demo("x")', kind: 'atom', ref: 'h/second-x.mjs' },
      { trigger: 'node("--help")', kind: 'atom', ref: 'h/second-help.mjs' }
    ]
  }));
  await fs.writeFile(path.join(root, 'registries/registry.json'), JSON.stringify({
    registries: [
      { registry: 'first', registryRef: 'registries/test.registry.json' },
      { registry: 'second', registryRef: 'registries/second.registry.json' }
    ]
  }));
  return loadRegistries({ indexPath: path.join(root, 'registries/registry.json'), codeRoot: root });
}

test('exact match beats a wildcard in the same registry', async () => {
  const registries = await twoRegistries();
  assert.equal(resolveTrigger({ trigger: 'node("--version")', registries }).registryAct.ref, 'h/exact.mjs');
});

test('wildcard matches any arguments of its domain', async () => {
  const registries = await twoRegistries();
  const resolution = resolveTrigger({ trigger: 'node("-e", "1")', registries });
  assert.equal(resolution.registryAct.ref, 'h/wild.mjs');
  assert.deepEqual(resolution.parsedTrigger.arguments, ['-e', '1']);
});

test('cascade: an earlier registry wins over a later one', async () => {
  const registries = await twoRegistries();
  // node("--help") exists exactly in "second", but "first" has node("*")
  assert.equal(resolveTrigger({ trigger: 'node("--help")', registries }).registry, 'first');
  assert.equal(resolveTrigger({ trigger: 'demo("x")', registries }).registry, 'second');
});

test('unknown and malformed triggers are reported, not thrown', async () => {
  const registries = await twoRegistries();
  assert.equal(resolveTrigger({ trigger: 'nope("x")', registries }).error.code, 'TRIGGER_NOT_FOUND');
  assert.equal(resolveTrigger({ trigger: 'bad', registries }).error.code, 'TRIGGER_SYNTAX_INVALID');
});

test('a registryRef outside the code root is refused', async () => {
  const root = await makeCodeRoot({ acts: [] });
  await fs.writeFile(path.join(root, 'registries/registry.json'), JSON.stringify({
    registries: [{ registry: 'evil', registryRef: '../outside.json' }]
  }));
  await assert.rejects(
    loadRegistries({ indexPath: path.join(root, 'registries/registry.json'), codeRoot: root }),
    { code: 'REF_OUTSIDE_CODE_ROOT' }
  );
});
