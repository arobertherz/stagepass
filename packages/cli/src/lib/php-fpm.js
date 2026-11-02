import { defaultExec } from './exec.js';

/**
 * Ensure Homebrew PHP-FPM is running (non-interactive, never sudo).
 * Uses `brew services start php`, falling back to `restart` if start fails.
 *
 * @param {object} [opts]
 * @param {import('./exec.js').ExecFn} [opts.exec]
 * @param {'ignore'|'inherit'} [opts.stdio]
 * @returns {Promise<{ ok: boolean, action: string, detail?: string }>}
 */
export async function ensurePhpFpm(opts = {}) {
  const exec = opts.exec || defaultExec;
  const stdio = opts.stdio || 'ignore';

  try {
    await exec('brew', ['services', 'start', 'php'], { stdio });
    return { ok: true, action: 'start' };
  } catch (startError) {
    try {
      await exec('brew', ['services', 'restart', 'php'], { stdio });
      return { ok: true, action: 'restart' };
    } catch (restartError) {
      const detail = [
        startError instanceof Error ? startError.message : String(startError),
        restartError instanceof Error ? restartError.message : String(restartError),
      ]
        .filter(Boolean)
        .join(' | ');
      return { ok: false, action: 'failed', detail };
    }
  }
}
