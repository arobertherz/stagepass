import { defaultExec } from './exec.js';

/** v3 site blocks (`match status 2xx`) need Caddy 2.9+. */
export const CADDY_UPGRADE_HINT = 'brew upgrade caddy';

/**
 * Read `caddy version` (`v2.10.2 h1:...`) and whether it is at least 2.9.0.
 * Not found, or output that does not parse, is `{ known: false }` so callers
 * keep the previous behaviour.
 *
 * @param {import('./exec.js').ExecFn} [exec]
 * @returns {Promise<{ known: true, version: string, ok: boolean } | { known: false }>}
 */
export async function readCaddyVersion(exec = defaultExec) {
  let text = '';
  try {
    const result = await exec('caddy', ['version']);
    text = `${result && result.stdout ? result.stdout : ''}\n${result && result.stderr ? result.stderr : ''}`;
  } catch {
    return { known: false };
  }
  const match = text.match(/v(\d+)\.(\d+)\.(\d+)/);
  if (!match) return { known: false };
  const major = Number(match[1]);
  const minor = Number(match[2]);
  return {
    known: true,
    version: `${major}.${minor}.${match[3]}`,
    ok: major > 2 || (major === 2 && minor >= 9),
  };
}
