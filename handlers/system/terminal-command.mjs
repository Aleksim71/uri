// handlers/system/terminal-command.mjs
//
// Generic handler for "true" triggers that look like a terminal command:
// git("status"), node("--version"). The trigger's domain becomes the
// command, its arguments become CLI arguments. Registered once per command
// through a wildcard route, e.g. { "trigger": "git(\"*\")", ... }.
//
// spawn() runs without a shell, so arguments are never shell-interpreted.
// The command itself is still trusted: node("*") permits node -e "<code>".
// See README "Deliberately not implemented" (deny-list / sandbox).
//
// A non-zero exit code becomes an exception, which the critic turns into
// "terminate" - nothing else in the engine has to know about processes.

import { spawn } from 'node:child_process';

const DEFAULT_TIMEOUT_MS = 30_000;

export async function execute({ trigger, context }) {
  const command = trigger.domain;
  const args = trigger.arguments;
  const timeoutMs = context?.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { shell: false });

    let stdout = '';
    let stderr = '';
    let timedOut = false;

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGKILL');
    }, timeoutMs);

    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });

    child.on('error', (error) => {
      clearTimeout(timer);
      error.code = error.code === 'ENOENT' ? 'TERMINAL_COMMAND_NOT_FOUND' : 'TERMINAL_SPAWN_FAILED';
      reject(error);
    });

    child.on('close', (exitCode) => {
      clearTimeout(timer);
      if (timedOut) {
        const error = new Error(`Command "${command}" timed out after ${timeoutMs}ms`);
        error.code = 'TERMINAL_COMMAND_TIMEOUT';
        reject(error);
        return;
      }
      if (exitCode !== 0) {
        const error = new Error(`Command "${command} ${args.join(' ')}" exited with code ${exitCode}`);
        error.code = 'TERMINAL_COMMAND_NONZERO_EXIT';
        error.details = { command, args, exitCode, stdout, stderr };
        reject(error);
        return;
      }
      resolve({ command, args, exitCode, stdout, stderr });
    });
  });
}
