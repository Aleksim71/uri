import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { Interpreter } from '../engine/interpreter.mjs';
import { makeCodeRoot, handlers } from './helpers.mjs';

beforeEach(() => { globalThis.__calls = []; });

const baseActs = [
  { trigger: 't("ok")', kind: 'atom', ref: 'h/ok.mjs' },
  { trigger: 't("fail")', kind: 'atom', ref: 'h/fail.mjs' },
  { trigger: 't("record")', kind: 'atom', ref: 'h/record.mjs' },
  { trigger: 't("list")', kind: 'list', ref: 's/nested.json' }
];
const baseFiles = {
  'h/ok.mjs': handlers.ok,
  'h/fail.mjs': handlers.fail,
  'h/record.mjs': handlers.record,
  's/nested.json': { acts: [{ trigger: 't("record")' }, { trigger: 't("ok")' }] }
};

async function engine({ acts = [], files = {}, guards } = {}) {
  const codeRoot = await makeCodeRoot({ acts: [...baseActs, ...acts], files: { ...baseFiles, ...files } });
  return new Interpreter({ codeRoot, guards });
}

const triggers = (result) => result.trace.map((step) => step.trigger);

test('happy path: nested list is expanded in order, onSuccess runs', async () => {
  const uri = await engine();
  const result = await uri.run({
    onSuccess: 't("record")',
    acts: [{ trigger: 't("ok")' }, { trigger: 't("list")' }, { trigger: 't("ok")' }]
  });
  assert.equal(result.outcome, 'completed');
  assert.deepEqual(triggers(result), ['t("ok")', 't("list")', 't("record")', 't("ok")', 't("ok")']);
  assert.equal(result.hook.outcome, 'completed');
  assert.equal(globalThis.__calls.length, 2); // once from the list, once as onSuccess
});

test('handler failure stops the scenario and runs onError with the reason', async () => {
  const uri = await engine();
  const result = await uri.run({
    onError: 't("record")',
    acts: [{ trigger: 't("ok")' }, { trigger: 't("fail")' }, { trigger: 't("ok")' }]
  });
  assert.equal(result.outcome, 'failed');
  assert.equal(result.reasonCode, 'TEST_FAILURE');
  assert.deepEqual(triggers(result), ['t("ok")', 't("fail")']);
  assert.equal(globalThis.__calls[0].context.reasonCode, 'TEST_FAILURE');
});

// Every engine-level problem takes the same path as a handler failure:
// { outcome: 'failed' } plus onError - never an exception thrown at the caller.
const engineFailures = [
  {
    name: 'unknown trigger',
    scenario: { acts: [{ trigger: 't("missing")' }] },
    reasonCode: 'TRIGGER_NOT_FOUND'
  },
  {
    name: 'malformed trigger',
    scenario: { acts: [{ trigger: 'not a trigger' }] },
    reasonCode: 'TRIGGER_SYNTAX_INVALID'
  },
  {
    name: 'handler file does not exist',
    acts: [{ trigger: 't("ghost")', kind: 'atom', ref: 'h/ghost.mjs' }],
    scenario: { acts: [{ trigger: 't("ghost")' }] },
    reasonCode: 'HANDLER_LOAD_FAILED'
  },
  {
    name: 'handler without execute()',
    acts: [{ trigger: 't("noexec")', kind: 'atom', ref: 'h/noexec.mjs' }],
    files: { 'h/noexec.mjs': 'export const x = 1;' },
    scenario: { acts: [{ trigger: 't("noexec")' }] },
    reasonCode: 'HANDLER_EXECUTE_MISSING'
  },
  {
    name: 'ref outside the code root',
    acts: [{ trigger: 't("escape")', kind: 'atom', ref: '../../etc/evil.mjs' }],
    scenario: { acts: [{ trigger: 't("escape")' }] },
    reasonCode: 'REF_OUTSIDE_CODE_ROOT'
  },
  {
    name: 'same trigger more than 3 times in a row',
    scenario: { acts: Array(4).fill({ trigger: 't("ok")' }) },
    reasonCode: 'CYCLE_SUSPECTED'
  },
  {
    name: 'list that includes itself',
    acts: [{ trigger: 't("self")', kind: 'list', ref: 's/self.json' }],
    files: { 's/self.json': { acts: [{ trigger: 't("ok")' }, { trigger: 't("self")' }] } },
    scenario: { acts: [{ trigger: 't("self")' }] },
    reasonCode: 'MAX_LIST_DEPTH_EXCEEDED'
  },
  {
    name: 'scenario without acts',
    scenario: { acts: [] },
    reasonCode: 'SCENARIO_INVALID'
  }
];

for (const { name, acts, files, scenario, reasonCode } of engineFailures) {
  test(`engine failure goes through onError: ${name}`, async () => {
    const uri = await engine({ acts, files });
    const result = await uri.run({ ...scenario, onError: 't("record")' });
    assert.equal(result.outcome, 'failed');
    assert.equal(result.reasonCode, reasonCode);
    assert.equal(result.hook.outcome, 'completed');
    assert.equal(globalThis.__calls.length, 1);
    assert.equal(globalThis.__calls[0].context.reasonCode, reasonCode);
  });
}

test('exactly 3 repeats in a row are allowed', async () => {
  const uri = await engine();
  const result = await uri.run({ acts: Array(3).fill({ trigger: 't("ok")' }) });
  assert.equal(result.outcome, 'completed');
});

test('a failing onError hook is reported, not swallowed', async () => {
  const uri = await engine();
  const result = await uri.run({ onError: 't("fail")', acts: [{ trigger: 't("missing")' }] });
  assert.equal(result.reasonCode, 'TRIGGER_NOT_FOUND');
  assert.deepEqual(
    { outcome: result.hook.outcome, reasonCode: result.hook.reasonCode },
    { outcome: 'failed', reasonCode: 'TEST_FAILURE' }
  );
});

test('act count guard', async () => {
  const uri = await engine({ guards: { maxActCount: 2 } });
  const result = await uri.run({ acts: [{ trigger: 't("ok")' }, { trigger: 't("record")' }, { trigger: 't("ok")' }] });
  assert.equal(result.reasonCode, 'MAX_ACT_COUNT_EXCEEDED');
});

test('registries are read once per interpreter, not once per act', async () => {
  const fs = await import('node:fs/promises');
  const path = await import('node:path');
  const codeRoot = await makeCodeRoot({ acts: baseActs, files: baseFiles });
  const uri = new Interpreter({ codeRoot });
  assert.equal((await uri.run({ acts: [{ trigger: 't("ok")' }] })).outcome, 'completed');

  // Break the registry on disk: a cached interpreter keeps working.
  await fs.writeFile(path.join(codeRoot, 'registries/test.registry.json'), 'not json');
  assert.equal((await uri.run({ acts: [{ trigger: 't("ok")' }, { trigger: 't("list")' }] })).outcome, 'completed');
});
