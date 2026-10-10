import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execute } from '../handlers/system/terminal-command.mjs';

const node = (...args) => ({ trigger: { domain: process.execPath, arguments: args } });

test('runs a command without a shell and returns its output', async () => {
  const result = await execute(node('-e', 'process.stdout.write("hi; echo nope")'));
  assert.equal(result.stdout, 'hi; echo nope');
  assert.equal(result.exitCode, 0);
});

test('non-zero exit becomes an error with details', async () => {
  await assert.rejects(execute(node('-e', 'process.exit(3)')), (error) => {
    assert.equal(error.code, 'TERMINAL_COMMAND_NONZERO_EXIT');
    assert.equal(error.details.exitCode, 3);
    return true;
  });
});

test('unknown command and timeout have their own codes', async () => {
  await assert.rejects(execute({ trigger: { domain: 'definitely-not-a-command', arguments: [] } }),
    { code: 'TERMINAL_COMMAND_NOT_FOUND' });
  await assert.rejects(execute({ ...node('-e', 'setTimeout(() => {}, 5000)'), context: { timeoutMs: 100 } }),
    { code: 'TERMINAL_COMMAND_TIMEOUT' });
});
