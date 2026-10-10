import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseTrigger, canonicalTrigger } from '../engine/trigger.mjs';

test('parses domain and quoted arguments', () => {
  assert.deepEqual(parseTrigger('git("commit", "-m")'), { domain: 'git', arguments: ['commit', '-m'] });
  assert.deepEqual(parseTrigger('demo()'), { domain: 'demo', arguments: [] });
});

test('supports escaped quotes and backslashes', () => {
  assert.deepEqual(parseTrigger('say("a \\"b\\" \\\\ c")').arguments, ['a "b" \\ c']);
});

test('canonical form ignores whitespace differences', () => {
  const a = canonicalTrigger(parseTrigger('demo( "x" ,"y" )'));
  const b = canonicalTrigger(parseTrigger('demo("x", "y")'));
  assert.equal(a, b);
});

test('rejects malformed triggers with TRIGGER_SYNTAX_INVALID', () => {
  for (const bad of ['', 'Demo("x")', 'demo(x)', 'demo("x",)', 'demo("x" "y")', 'demo("unclosed)', 'demo("\\n")']) {
    assert.throws(() => parseTrigger(bad), { code: 'TRIGGER_SYNTAX_INVALID' }, bad);
  }
});
