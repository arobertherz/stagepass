import { execFile as nodeExecFile, spawn } from 'node:child_process';
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
 * @param {NodeJS.ErrnoException & { stdout?: string, stderr?: string, code?: number|string, killed?: boolean, signal?: string }} err
 * @returns {Error}
 */
function wrapExecError(err) {
  const wrapped = new Error(err.message || String(err));
  Object.assign(wrapped, {
    code: err.code,
    errno: err.errno,
    stdout: err.stdout != null ? String(err.stdout) : '',
    stderr: err.stderr != null ? String(err.stderr) : '',
    killed: err.killed,
    signal: err.signal,
  });
  return wrapped;
}

/**
 * Wait for spawn exit when stdout/stderr are not captured pipes.
 * Avoids execFile+encoding hanging while a daemon grandchild still holds
 * inherited logfile FDs (public `stagepass start` non-verbose path).
 * @param {string} file
 * @param {string[]} args
 * @param {object} options
 * @returns {Promise<ExecResult>}
 */
function spawnWait(file, args, options) {
  return new Promise((resolve, reject) => {
    const child = spawn(file, args, { ...options, shell: false });
    child.on('error', (error) => {
      reject(wrapExecError(/** @type {NodeJS.ErrnoException} */ (error)));
    });
    child.on('close', (code, signal) => {
      if (code === 0) {
        resolve({ stdout: '', stderr: '', code: 0 });
        return;
      }
      const err = /** @type {NodeJS.ErrnoException & { code?: number|string, signal?: string }} */ (
        new Error(`Command failed: ${file} ${args.join(' ')}`)
      );
      err.code = code == null ? signal || 1 : code;
      err.signal = signal || undefined;
      reject(wrapExecError(err));
    });
  });
}

/**
 * Default execFile wrapper. Always uses argument arrays (never a shell string).
 * @type {ExecFn}
 */
export async function defaultExec(file, args = [], options = {}) {
  const stdio = options.stdio;
  const inheritStdio = stdio === 'inherit';
  const customStdio = inheritStdio || Array.isArray(stdio) || stdio === 'ignore';

  // Capture-output path (doctor/certs/which): execFile + encoding.
  // Custom stdio (start logfile FDs / inherit): spawn + wait for exit only.
  if (customStdio) {
    try {
      return await spawnWait(file, args, { ...options, shell: false });
    } catch (error) {
      throw error instanceof Error ? error : wrapExecError(/** @type {any} */ (error));
    }
  }

  try {
    const result = await execFileAsync(file, args, {
      encoding: 'utf8',
      maxBuffer: 4 * 1024 * 1024,
      ...options,
      shell: false,
    });
    return {
      stdout: result?.stdout != null ? String(result.stdout) : '',
      stderr: result?.stderr != null ? String(result.stderr) : '',
      code: 0,
    };
  } catch (error) {
    throw wrapExecError(
      /** @type {NodeJS.ErrnoException & { stdout?: string, stderr?: string, code?: number|string, killed?: boolean, signal?: string }} */ (
        error
      )
    );
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
