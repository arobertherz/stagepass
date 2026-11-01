import os from 'os';
import path from 'path';

/** Stagepass config directory (~/.stagepass). */
export function getStagepassDir() {
  return path.join(os.homedir(), '.stagepass');
}

export function getCaddyfilePath() {
  return path.join(getStagepassDir(), 'Caddyfile');
}

export function getProjectsPath() {
  return path.join(getStagepassDir(), 'projects.json');
}

export function getServerLogPath() {
  return path.join(getStagepassDir(), 'server.log');
}

/** System / dangerous roots that must never be linked as site roots. */
export const FORBIDDEN_ROOTS = Object.freeze([
  '/',
  '/Users',
  '/System',
  '/Library',
  '/Applications',
  '/private',
  '/etc',
  '/bin',
  '/usr',
  '/sbin',
  '/var',
  '/dev',
]);

/**
 * Escape a path for use inside a Caddyfile double-quoted token.
 * @param {string} value
 * @returns {string}
 */
export function escapeCaddyQuotedString(value) {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

/**
 * Validate a project root path before writing it into the Caddyfile.
 * @param {string} rootPath
 * @returns {{ ok: true, path: string } | { ok: false, error: string }}
 */
export function validateRoot(rootPath) {
  if (typeof rootPath !== 'string' || rootPath.length === 0) {
    return { ok: false, error: 'Project path is empty.' };
  }

  if (/[\x00-\x1f\x7f]/.test(rootPath)) {
    return { ok: false, error: 'Project path contains control characters or newlines.' };
  }

  const resolved = path.resolve(rootPath);
  const home = path.resolve(os.homedir());

  if (resolved === home) {
    return { ok: false, error: 'Refusing to link your home directory as a site root.' };
  }

  for (const forbidden of FORBIDDEN_ROOTS) {
    if (resolved === path.resolve(forbidden)) {
      return { ok: false, error: `Refusing to link system path "${forbidden}" as a site root.` };
    }
  }

  return { ok: true, path: resolved };
}
