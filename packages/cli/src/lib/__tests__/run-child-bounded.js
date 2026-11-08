import { spawn } from 'node:child_process';

/**
 * Run a child with streaming output cap, short deadline, TERM→KILL, and
 * post-exit cleanup assertions. Sync Infinity loops in the child cannot block
 * the parent event loop.
 *
 * @param {object} opts
 * @param {string} [opts.command] defaults to process.execPath
 * @param {string[]} opts.args
 * @param {number} opts.deadlineMs
 * @param {number} opts.outputBudget max bytes retained/read before TERM
 * @param {number} [opts.killGraceMs]
 * @param {string} [opts.label]
 * @param {NodeJS.ProcessEnv} [opts.env]
 * @param {string} [opts.cwd]
 * @returns {Promise<{
 *   code: number|null,
 *   signal: NodeJS.Signals|null,
 *   bytes: number,
 *   output: string,
 *   capped: boolean,
 *   timedOut: boolean,
 *   pid: number|null,
 *   aliveAfterClose: boolean,
 * }>}
 */
export function runChildBounded(opts) {
  const {
    command = process.execPath,
    args,
    deadlineMs,
    outputBudget,
    killGraceMs = 400,
    label = 'child',
    env,
    cwd,
  } = opts;

  return new Promise((resolve, reject) => {
    /** @type {import('node:child_process').ChildProcess} */
    const child = spawn(command, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: env ? { ...process.env, ...env } : process.env,
      cwd,
    });

    let bytes = 0;
    let output = '';
    let capped = false;
    let timedOut = false;
    let settled = false;
    /** @type {ReturnType<typeof setTimeout>|undefined} */
    let killTimer;
    /** @type {ReturnType<typeof setTimeout>|undefined} */
    let deadlineTimer;

    const destroyStdio = () => {
      for (const stream of [child.stdin, child.stdout, child.stderr]) {
        try {
          stream?.destroy();
        } catch {
          /* ignore */
        }
      }
    };

    const stopChild = (hard) => {
      if (!child.pid) return;
      try {
        child.kill(hard ? 'SIGKILL' : 'SIGTERM');
      } catch {
        /* ignore */
      }
    };

    const onChunk = (chunk) => {
      bytes += chunk.length;
      if (output.length < outputBudget) {
        const remain = outputBudget - output.length;
        output += chunk.toString('utf8').slice(0, Math.max(0, remain));
      }
      if (!capped && bytes > outputBudget) {
        capped = true;
        stopChild(false);
        killTimer = setTimeout(() => stopChild(true), killGraceMs);
      }
    };

    child.stdout?.on('data', onChunk);
    child.stderr?.on('data', onChunk);

    deadlineTimer = setTimeout(() => {
      timedOut = true;
      stopChild(false);
      killTimer = setTimeout(() => stopChild(true), killGraceMs);
    }, deadlineMs);

    child.once('error', (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(deadlineTimer);
      clearTimeout(killTimer);
      destroyStdio();
      reject(new Error(`${label} spawn error: ${err.message}`));
    });

    child.once('close', (code, signal) => {
      if (settled) return;
      settled = true;
      clearTimeout(deadlineTimer);
      clearTimeout(killTimer);
      destroyStdio();

      let aliveAfterClose = false;
      if (child.pid) {
        try {
          process.kill(child.pid, 0);
          aliveAfterClose = true;
        } catch {
          aliveAfterClose = false;
        }
      }

      resolve({
        code,
        signal,
        bytes,
        output,
        capped,
        timedOut,
        pid: child.pid ?? null,
        aliveAfterClose,
      });
    });
  });
}
