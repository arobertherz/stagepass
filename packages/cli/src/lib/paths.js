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

/** Daemon / autostart log directory (~/.stagepass/logs). */
export function getLogsDir() {
  return path.join(getStagepassDir(), 'logs');
}

export function getDaemonStdoutLogPath() {
  return path.join(getLogsDir(), 'daemon.stdout.log');
}

export function getDaemonStderrLogPath() {
  return path.join(getLogsDir(), 'daemon.stderr.log');
}

/** LaunchAgent label (owned GitHub-io reverse DNS; not a third-party domain). */
export const LAUNCH_AGENT_LABEL = 'io.github.arobertherz.stagepass';

export function getLaunchAgentsDir() {
  return path.join(os.homedir(), 'Library', 'LaunchAgents');
}

export function getLaunchAgentPlistPath() {
  return path.join(getLaunchAgentsDir(), `${LAUNCH_AGENT_LABEL}.plist`);
}

/**
 * Caddy default data directory on macOS (user instance).
 * Honours XDG_DATA_HOME when set (same rules as Caddy itself).
 * @param {{ home?: string, env?: NodeJS.ProcessEnv }} [opts]
 */
export function getCaddyDataDir(opts = {}) {
  const env = opts.env || process.env;
  const home = opts.home || os.homedir();
  if (env.XDG_DATA_HOME) {
    return path.join(env.XDG_DATA_HOME, 'caddy');
  }
  return path.join(home, 'Library', 'Application Support', 'Caddy');
}

/**
 * Path to Caddy's local root CA certificate.
 * @param {{ home?: string, env?: NodeJS.ProcessEnv, dataDir?: string }} [opts]
 */
export function getCaddyRootCaPath(opts = {}) {
  const dataDir = opts.dataDir || getCaddyDataDir(opts);
  return path.join(dataDir, 'pki', 'authorities', 'local', 'root.crt');
}

/**
 * Caddy local CA authority directory (contains root.crt / intermediate).
 * @param {{ home?: string, env?: NodeJS.ProcessEnv, dataDir?: string }} [opts]
 */
export function getCaddyPkiAuthoritiesLocalDir(opts = {}) {
  const dataDir = opts.dataDir || getCaddyDataDir(opts);
  return path.join(dataDir, 'pki', 'authorities', 'local');
}

/**
 * Caddy on-disk site certificate store for the internal ("local") issuer.
 * @param {{ home?: string, env?: NodeJS.ProcessEnv, dataDir?: string }} [opts]
 */
export function getCaddyCertificatesLocalDir(opts = {}) {
  const dataDir = opts.dataDir || getCaddyDataDir(opts);
  return path.join(dataDir, 'certificates', 'local');
}

/**
 * Common secondary data dir when Homebrew's Caddy service sets XDG_DATA_HOME.
 * Report-only helper for doctor/certs (never delete).
 * @param {{ brewPrefix?: string|null }} [opts]
 */
export function getBrewCaddyDataDir(opts = {}) {
  const prefix = opts.brewPrefix;
  if (!prefix) return null;
  return path.join(prefix, 'var', 'lib', 'caddy');
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
