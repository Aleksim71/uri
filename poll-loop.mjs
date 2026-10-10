// poll-loop.mjs
//
// The simplest possible scheduler: runs a scenario every N minutes. The
// engine knows nothing about schedules (and should not) - this is a
// separate, external layer. For permanent use on a server a system
// scheduler (cron / systemd timer) is the better choice: it survives
// restarts and does not depend on this node process staying alive.
//
// Usage: node poll-loop.mjs scenarios/freelancehunt/poll.json 15
//
// Each run is a separate child process. If a run is still going when the
// next tick comes, that tick is skipped instead of starting a second run
// that would touch the same artifact files.

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';

const CODE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)));
const scenarioArg = process.argv[2] ?? 'scenarios/freelancehunt/poll.json';
const intervalMinutes = Number(process.argv[3] ?? 15);

if (!Number.isFinite(intervalMinutes) || intervalMinutes <= 0) {
  console.error('Interval must be a positive number of minutes');
  process.exit(1);
}

let running = false;

function runOnce() {
  if (running) {
    console.log(`[poll-loop] previous run still in progress, skipping this tick`);
    return;
  }
  running = true;
  console.log(`\n[poll-loop] ${new Date().toISOString()} running ${scenarioArg}`);
  execFile(process.execPath, ['run.mjs', scenarioArg], { cwd: CODE_ROOT }, (error, stdout, stderr) => {
    running = false;
    if (stdout) process.stdout.write(stdout);
    if (stderr) process.stderr.write(stderr);
    if (error) console.error('[poll-loop] scenario failed (see output above)');
  });
}

console.log(`[poll-loop] running "${scenarioArg}" every ${intervalMinutes} min. Ctrl+C to stop.`);
runOnce();
setInterval(runOnce, intervalMinutes * 60 * 1000);
