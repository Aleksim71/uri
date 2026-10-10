// engine/interpreter.mjs
//
// The engine is intentionally "dumb": what success means, what an error
// means and what to do next all live in registries and handlers. The only
// logic built into the engine itself is guarding against runaway execution.
//
// Loop:
//   1. take the next act (from the stack, otherwise from the scenario list)
//   2. resolve it in the registry cascade (kind: atom | list)
//   3. list -> push the nested scenario onto the stack
//      atom -> the actor runs the handler, the critic turns the result into
//              continue | terminate
//   4. stack and scenario exhausted -> run the onSuccess hook (if any)
//   5. ANY failure -> run the onError hook (if any), then stop
//
// Every failure takes the same path: a failing handler, an unknown trigger,
// a missing handler file, a guard (cycle, depth, act count, stack size) or a
// ref pointing outside the code root all end as { outcome: 'failed' } with a
// reasonCode, and all of them trigger onError. The engine never throws at
// the caller for a scenario-level problem.

import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { RuntimeStack } from './runtime-stack.mjs';
import { loadRegistries, resolveTrigger } from './registry.mjs';
import { resolveInside } from './paths.mjs';

export const DEFAULT_GUARDS = Object.freeze({
  maxActCount: 10_000,
  maxStackSize: 1_000,
  maxListDepth: 64,
  // How many times the same trigger may run back to back. The next repeat
  // (the 4th with the default) is treated as a suspected cycle. This is a
  // coarse heuristic, see README "Known limitations".
  maxConsecutiveRepeats: 3
});

class EngineFailure extends Error {
  constructor(reasonCode, message, details = null) {
    super(message);
    this.reasonCode = reasonCode;
    this.details = details;
  }
}

function toFailure(error) {
  if (error instanceof EngineFailure) return error;
  return new EngineFailure(error?.code ?? 'ENGINE_ERROR', error?.message ?? String(error));
}

async function readJson(filePath) {
  return JSON.parse(await fs.readFile(filePath, 'utf8'));
}

// --- actor ---------------------------------------------------------------
// Delegates to the handler the registry act points to. It does not decide
// what success is - it only hands the handler's outcome to the critic.
async function actorExecute({ registryAct, act, parsedTrigger, codeRoot, context }) {
  const handlerPath = resolveInside(codeRoot, registryAct.ref);

  let handlerModule;
  try {
    handlerModule = await import(pathToFileURL(handlerPath).href);
  } catch (error) {
    return {
      status: 'failed',
      diagnostics: { code: 'HANDLER_LOAD_FAILED', message: `Cannot load ${registryAct.ref}: ${error.message}` }
    };
  }

  if (typeof handlerModule.execute !== 'function') {
    return {
      status: 'failed',
      diagnostics: {
        code: 'HANDLER_EXECUTE_MISSING',
        message: `Handler ${registryAct.ref} must export an async function execute()`
      }
    };
  }

  try {
    const data = await handlerModule.execute({ act, trigger: parsedTrigger, registryAct, context });
    return { status: 'completed', data };
  } catch (error) {
    return {
      status: 'failed',
      diagnostics: {
        code: error.code ?? 'HANDLER_EXECUTION_FAILED',
        message: error.message,
        ...(error.details ? { details: error.details } : {})
      }
    };
  }
}

// --- critic --------------------------------------------------------------
// A fixed policy: completed -> continue, failed -> terminate. There is no
// "smart" evaluation here on purpose. If it is ever needed (e.g. retry vs.
// escalate), it changes in this one function.
function criticConclude(rawResult) {
  if (rawResult.status === 'completed') return { directive: 'continue' };
  return {
    directive: 'terminate',
    reasonCode: rawResult.diagnostics?.code ?? 'RUNTIME_ACT_EXECUTION_FAILED',
    diagnostics: rawResult.diagnostics ?? null
  };
}

function assertScenario(scenario, label) {
  if (!scenario || !Array.isArray(scenario.acts) || scenario.acts.length === 0) {
    throw new EngineFailure('SCENARIO_INVALID', `${label} must contain a non-empty "acts" array`);
  }
}

export class Interpreter {
  #codeRoot;
  #registryIndexPath;
  #guards;
  #registries = null;

  constructor({ codeRoot, registryIndexPath = 'registries/registry.json', guards = {} }) {
    this.#codeRoot = path.resolve(codeRoot);
    this.#registryIndexPath = path.resolve(this.#codeRoot, registryIndexPath);
    this.#guards = { ...DEFAULT_GUARDS, ...guards };
  }

  // Registries are read once per Interpreter instance, not once per act.
  #getRegistries() {
    if (!this.#registries) {
      this.#registries = loadRegistries({ indexPath: this.#registryIndexPath, codeRoot: this.#codeRoot });
      this.#registries.catch(() => { this.#registries = null; });
    }
    return this.#registries;
  }

  async #resolve(trigger) {
    let registries;
    try {
      registries = await this.#getRegistries();
    } catch (error) {
      throw new EngineFailure(error.code ?? 'REGISTRY_LOAD_FAILED', error.message);
    }
    const resolution = resolveTrigger({ trigger, registries });
    if (resolution.status !== 'resolved') {
      throw new EngineFailure(resolution.error.code, resolution.error.message);
    }
    return resolution;
  }

  async run(scenario) {
    const trace = [];
    let result;

    try {
      assertScenario(scenario, 'Scenario');
      await this.#execute(scenario, { trace, context: {} });
      result = { outcome: 'completed', reasonCode: 'SCENARIO_AND_STACK_EXHAUSTED', trace };
      if (scenario.onSuccess) {
        result.hook = await this.#runHook(scenario.onSuccess, {});
      }
    } catch (error) {
      const failure = toFailure(error);
      result = {
        outcome: 'failed',
        reasonCode: failure.reasonCode,
        message: failure.message,
        ...(failure.details ? { details: failure.details } : {}),
        trace
      };
      if (scenario?.onError) {
        result.hook = await this.#runHook(scenario.onError, {
          reasonCode: failure.reasonCode,
          message: failure.message,
          details: failure.details
        });
      }
    }

    return result;
  }

  async #execute(scenario, { trace, context }) {
    const guards = this.#guards;
    const stack = new RuntimeStack({ maxSize: guards.maxStackSize });
    let position = 0;
    let processedActs = 0;
    let lastTrigger = null;
    let repeats = 0;

    const nextAct = () => {
      if (!stack.isEmpty) return stack.pop();
      if (position >= scenario.acts.length) return null;
      const act = scenario.acts[position];
      position += 1;
      return { act, depth: 0 };
    };

    for (let selected = nextAct(); selected; selected = nextAct()) {
      const { act, depth } = selected;

      processedActs += 1;
      if (processedActs > guards.maxActCount) {
        throw new EngineFailure('MAX_ACT_COUNT_EXCEEDED', `Act count exceeded ${guards.maxActCount}`);
      }

      repeats = act?.trigger === lastTrigger ? repeats + 1 : 1;
      lastTrigger = act?.trigger;
      if (repeats > guards.maxConsecutiveRepeats) {
        throw new EngineFailure('CYCLE_SUSPECTED', `Trigger ${act.trigger} ran ${repeats} times in a row`);
      }

      const resolution = await this.#resolve(act?.trigger);
      const registryAct = resolution.registryAct;
      trace.push({ trigger: act.trigger, ...(act.comment ? { comment: act.comment } : {}), kind: registryAct.kind });

      if (registryAct.kind === 'list') {
        const nextDepth = depth + 1;
        if (nextDepth > guards.maxListDepth) {
          throw new EngineFailure('MAX_LIST_DEPTH_EXCEEDED', `List depth exceeded ${guards.maxListDepth}`);
        }
        const nested = await this.#readScenario(registryAct.ref);
        try {
          stack.pushList(nested.acts, nextDepth);
        } catch (error) {
          throw toFailure(error);
        }
        continue;
      }

      if (registryAct.kind !== 'atom') {
        throw new EngineFailure('REGISTRY_ACT_INVALID', `Unknown kind "${registryAct.kind}" for ${act.trigger}`);
      }

      const rawResult = await actorExecute({
        registryAct,
        act,
        parsedTrigger: resolution.parsedTrigger,
        codeRoot: this.#codeRoot,
        context
      });
      const conclusion = criticConclude(rawResult);

      if (conclusion.directive === 'terminate') {
        const reason = conclusion.diagnostics?.message;
        throw new EngineFailure(
          conclusion.reasonCode,
          reason ? `Act ${act.trigger} failed: ${reason}` : `Act ${act.trigger} failed`,
          conclusion.diagnostics
        );
      }
    }
  }

  async #readScenario(ref) {
    let filePath;
    try {
      filePath = resolveInside(this.#codeRoot, ref);
    } catch (error) {
      throw toFailure(error);
    }
    let scenario;
    try {
      scenario = await readJson(filePath);
    } catch (error) {
      throw new EngineFailure('SCENARIO_LOAD_FAILED', `Cannot load scenario ${ref}: ${error.message}`);
    }
    assertScenario(scenario, `Scenario ${ref}`);
    return scenario;
  }

  // onSuccess / onError. A hook never changes the scenario's outcome, but
  // its own result is reported instead of being silently dropped. A list
  // hook runs as a nested scenario without hooks of its own (no recursion).
  async #runHook(trigger, context) {
    try {
      const resolution = await this.#resolve(trigger);
      const registryAct = resolution.registryAct;
      if (registryAct.kind === 'list') {
        const nested = await this.#readScenario(registryAct.ref);
        await this.#execute(nested, { trace: [], context });
        return { trigger, outcome: 'completed' };
      }
      const rawResult = await actorExecute({
        registryAct,
        act: { trigger },
        parsedTrigger: resolution.parsedTrigger,
        codeRoot: this.#codeRoot,
        context
      });
      if (rawResult.status === 'completed') return { trigger, outcome: 'completed' };
      return { trigger, outcome: 'failed', reasonCode: rawResult.diagnostics?.code, message: rawResult.diagnostics?.message };
    } catch (error) {
      const failure = toFailure(error);
      return { trigger, outcome: 'failed', reasonCode: failure.reasonCode, message: failure.message };
    }
  }
}
