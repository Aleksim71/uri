import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RuntimeStack } from '../engine/runtime-stack.mjs';

test('pushList keeps list order when popping', () => {
  const stack = new RuntimeStack();
  stack.pushList(['a', 'b', 'c'], 1);
  assert.deepEqual([stack.pop(), stack.pop(), stack.pop()].map((e) => e.act), ['a', 'b', 'c']);
  assert.equal(stack.pop(), null);
});

test('size guard throws MAX_STACK_SIZE_EXCEEDED', () => {
  const stack = new RuntimeStack({ maxSize: 2 });
  assert.throws(() => stack.pushList(['a', 'b', 'c']), { code: 'MAX_STACK_SIZE_EXCEEDED' });
});

test('empty list is rejected', () => {
  assert.throws(() => new RuntimeStack().pushList([]), { code: 'SCENARIO_INVALID' });
});
