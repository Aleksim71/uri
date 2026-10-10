// handlers/demo/say-hello.mjs
//
// An atom handler is a plain async function.
// Success = it returns. Failure = it throws (the actor catches it and hands
// it to the critic).

export async function execute() {
  const message = 'Hello from Uri!';
  console.log(`[say-hello] ${message}`);
  return { message };
}
