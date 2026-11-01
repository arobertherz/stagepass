import { execFile as nodeExecFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(nodeExecFile);

/**
 * @typedef {object} ExecResult
 * @property {string} stdout
 * @property {string} stderr
 * @property {number|null} [code]
 */

/**
 * @typedef {(file: string, args?: string[], options?: object) => Promise<ExecResult>} ExecFn
 */

/**
 * Default execFile wrapper. Always uses argument arrays (never a shell string).
 * @type {ExecFn}
 */
export async function defaultExec(file, args = [], options = {}) {
  const inheritStdio = options.stdio === 'inherit';
  // Always force shell:false after spreading options so callers cannot enable a shell.
  const opts = inheritStdio
    ? { ...options, shell: false }
    : {
        encoding: 'utf8',
        maxBuffer: 4 * 1024 * 1024,
        ...options,
        shell: false,
      };
  try {
    const result = await execFileAsync(file, args, opts);
    return {
      stdout: result?.stdout != null ? String(result.stdout) : '',
      stderr: result?.stderr != null ? String(result.stderr) : '',
      code: 0,
    };
  } catch (error) {
    const err = /** @type {NodeJS.ErrnoException & { stdout?: string, stderr?: string, code?: number|string }} */ (
      error
    );
    const wrapped = new Error(err.message || String(error));
    Object.assign(wrapped, {
      code: err.code,
      errno: err.errno,
      stdout: err.stdout != null ? String(err.stdout) : '',
      stderr: err.stderr != null ? String(err.stderr) : '',
      killed: /** @type {{ killed?: boolean }} */ (err).killed,
      signal: /** @type {{ signal?: string }} */ (err).signal,
    });
    throw wrapped;
  }
}

/**
 * Resolve which executable exists via `command -v` style lookup without a shell.
 * Uses `which` on PATH via execFile.
 * @param {string} name
 * @param {ExecFn} [exec]
 * @returns {Promise<string|null>}
 */
export async function resolveCommand(name, exec = defaultExec) {
  try {
    const { stdout } = await exec('/usr/bin/env', ['which', name]);
    const path = stdout.trim().split('\n')[0];
    return path || null;
  } catch {
    return null;
  }
}
