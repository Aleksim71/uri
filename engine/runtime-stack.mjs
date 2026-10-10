// engine/runtime-stack.mjs
//
// The engine's runtime stack: acts waiting to be executed. When the engine
// expands a list act, all of its acts are pushed in reverse order so the
// first act of the list runs first.
//
// This is the only piece of state the engine owns directly.

function stackOverflow() {
  const error = new Error('Runtime stack size guard exceeded');
  error.code = 'MAX_STACK_SIZE_EXCEEDED';
  return error;
}

export class RuntimeStack {
  #entries = [];
  #maxSize;

  constructor({ maxSize = 1000 } = {}) {
    if (!Number.isInteger(maxSize) || maxSize < 1) {
      throw new TypeError('RuntimeStack maxSize must be a positive integer');
    }
    this.#maxSize = maxSize;
  }

  get size() {
    return this.#entries.length;
  }

  get isEmpty() {
    return this.#entries.length === 0;
  }

  pushAct(act, depth = 0) {
    if (this.size + 1 > this.#maxSize) throw stackOverflow();
    this.#entries.push({ act, depth });
  }

  pushList(acts, depth = 0) {
    if (!Array.isArray(acts) || acts.length === 0) {
      const error = new TypeError('Act list must contain at least one act');
      error.code = 'SCENARIO_INVALID';
      throw error;
    }
    if (this.size + acts.length > this.#maxSize) throw stackOverflow();
    for (let index = acts.length - 1; index >= 0; index -= 1) {
      this.pushAct(acts[index], depth);
    }
  }

  pop() {
    return this.#entries.pop() ?? null;
  }
}
