// handlers/demo/fail-on-purpose.mjs
//
// Demonstrates the error path: the handler throws, the actor catches it,
// the critic turns it into "terminate", the engine runs the onError hook.

export async function execute({ act }) {
  const error = new Error(`Handler for ${act.trigger} failed on purpose`);
  error.code = 'DEMO_INTENTIONAL_FAILURE';
  throw error;
}
