/**
 * Plan a missing PHP `.htaccess` for `stagepass upgrade`.
 * Covered when the file contains the shipped line `RewriteRule "(^|/)\." - [F]`.
 * Symlinks and directories are not followed and are not replaced.
 */

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fs from 'fs-extra';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** Exact deny line from templates/project/htaccess. */
export const HTACCESS_DENY_LINE = 'RewriteRule "(^|/)\\." - [F]';

const HTACCESS_DOCS = 'https://stagepass.one/docs/php/ and api/README.md';

export function defaultHtaccessTemplatePath() {
  return path.join(__dirname, '../../templates/project/htaccess');
}

export function htaccessHasDenyRule(source) {
  return String(source).includes(HTACCESS_DENY_LINE);
}

/**
 * Does not write. `php` must be the boolean from stagepass.json.
 *
 * @param {object} options
 * @param {string} options.cwd
 * @param {boolean} [options.php]
 * @param {{ lstat: Function, readFile: Function }} [options.fse]
 * @returns {Promise<{ action: 'skip' | 'create' | 'present' | 'hint' | 'blocked', content?: string, note?: string }>}
 */
export async function planHtaccessUpgrade(options) {
  if (options.php !== true) return { action: 'skip' };
  const fse = options.fse || fs;
  const abs = path.join(options.cwd, '.htaccess');
  /** @type {import('node:fs').Stats} */
  let st;
  try {
    st = await fse.lstat(abs);
  } catch (err) {
    if (err && /** @type {{ code?: string }} */ (err).code === 'ENOENT') {
      try {
        const content = await fse.readFile(defaultHtaccessTemplatePath(), 'utf8');
        return { action: 'create', content };
      } catch (readErr) {
        const detail = readErr instanceof Error ? readErr.message : String(readErr);
        return {
          action: 'blocked',
          note: `Could not read the .htaccess template (${detail}). Nothing was written.`,
        };
      }
    }
    return { action: 'blocked', note: '.htaccess could not be inspected; left unchanged.' };
  }
  if (st.isSymbolicLink()) {
    return { action: 'blocked', note: '.htaccess is a symlink; left unchanged.' };
  }
  if (st.isDirectory()) {
    return { action: 'blocked', note: '.htaccess is a directory; left unchanged.' };
  }
  if (!st.isFile()) {
    return { action: 'blocked', note: '.htaccess is not a regular file; left unchanged.' };
  }
  /** @type {string} */
  let raw;
  try {
    raw = await fse.readFile(abs, 'utf8');
  } catch {
    return { action: 'blocked', note: '.htaccess could not be read; left unchanged.' };
  }
  if (htaccessHasDenyRule(raw)) return { action: 'present' };
  return {
    action: 'hint',
    note: `.htaccess exists and has no ${HTACCESS_DENY_LINE} line. Left unchanged. See ${HTACCESS_DOCS}.`,
  };
}
