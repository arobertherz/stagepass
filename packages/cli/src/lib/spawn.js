import { spawn as nodeSpawn } from 'node:child_process';

/**
 * @typedef {object} SpawnResult
 * @property {number|null} code
 * @property {NodeJS.Signals|null} [signal]
 */

/**
 * @typedef {(command: string, args?: string[], options?: object) => Promise<SpawnResult>} SpawnFn
 */

/**
 * Spawn without a shell. Forwards stdio by default.
 * @type {SpawnFn}
 */
export function defaultSpawn(command, args = [], options = {}) {
  return new Promise((resolve, reject) => {
    const child = nodeSpawn(command, args, {
      stdio: 'inherit',
      shell: false,
      ...options,
    });
    child.on('error', reject);
    child.on('close', (code, signal) => {
      resolve({ code, signal });
    });
  });
}
