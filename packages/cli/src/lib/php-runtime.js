/**
 * Shared PHP 8.2+ / php-fpm (or php-cgi) check for new, doctor, dev, and watch.
 * `exec` is injectable. Never throws on a missing binary.
 */

import fs from 'fs-extra';
import path from 'node:path';
import { defaultExec, resolveCommand } from './exec.js';
import { phpFromStagepassConfig, readStagepassJson } from './project-sync.js';
import { ensurePhpFpm as defaultEnsurePhpFpm } from './php-fpm.js';

/** Drop C0/DEL and collapse whitespace so command output cannot break a line. */
export function plainLine(value, max = 240) {
  const text = String(value ?? '')
    .replace(/[\u0000-\u001F\u007F]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return text.length > max ? text.slice(0, max) : text;
}

/**
 * @param {string} text
 * @returns {{ major: number, minor: number, patch: number, label: string } | null}
 */
export function parsePhpVersion(text) {
  const match = plainLine(text).match(/PHP\s+(\d+)\.(\d+)\.(\d+)/);
  if (!match) return null;
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    label: `${match[1]}.${match[2]}.${match[3]}`,
  };
}

/**
 * @param {{ major: number, minor: number } | null} version
 */
export function phpVersionOk(version) {
  if (!version) return false;
  if (version.major > 8) return true;
  if (version.major < 8) return false;
  return version.minor >= 2;
}

/**
 * @param {string} [platform]
 */
export function phpInstallHint(platform) {
  if (platform === 'darwin') {
    return 'Install on macOS: brew install php\nThen start it: brew services start php';
  }
  return 'Install PHP 8.2 or newer and php-fpm (or php-cgi). On Debian/Ubuntu: sudo apt install php-fpm, then start the php-fpm service.';
}

/**
 * @param {import('./exec.js').ExecFn} exec
 * @param {string} file
 * @param {string[]} args
 */
async function capture(exec, file, args) {
  try {
    const result = await exec(file, args);
    return {
      stdout: result && result.stdout != null ? String(result.stdout) : '',
      stderr: result && result.stderr != null ? String(result.stderr) : '',
    };
  } catch (err) {
    const error = /** @type {{ stdout?: string, stderr?: string }} */ (err);
    return {
      stdout: error && error.stdout != null ? String(error.stdout) : '',
      stderr: error && error.stderr != null ? String(error.stderr) : '',
    };
  }
}

/**
 * @param {object} [opts]
 * @param {import('./exec.js').ExecFn} [opts.exec]
 * @param {typeof resolveCommand} [opts.resolveCommand]
 * @param {(p: string) => Promise<boolean>} [opts.pathExists]
 * @param {string|null} [opts.brewPrefix]
 * @param {string} [opts.platform]
 * @returns {Promise<{
 *   ok: boolean,
 *   status: 'ok'|'warn'|'fail',
 *   message: string,
 *   detail: string,
 *   version: { major: number, minor: number, patch: number, label: string } | null,
 *   phpPath: string|null,
 *   fastcgi: string|null,
 * }>}
 */
export async function checkPhpRuntime(opts = {}) {
  const exec = opts.exec || defaultExec;
  const which = opts.resolveCommand || resolveCommand;
  const pathExists = opts.pathExists || ((p) => fs.pathExists(p));
  const platform = opts.platform || process.platform;
  const hint = phpInstallHint(platform);

  const phpPath = await which('php', exec);
  let fpm = await which('php-fpm', exec);
  const cgi = await which('php-cgi', exec);
  if (!fpm && opts.brewPrefix) {
    const candidate = path.join(opts.brewPrefix, 'sbin', 'php-fpm');
    if (await pathExists(candidate)) fpm = candidate;
  }
  const fastcgi = fpm || cgi || null;
  const fastcgiLabel = fpm ? 'php-fpm' : 'php-cgi';

  /** @type {{ major: number, minor: number, patch: number, label: string } | null} */
  let version = null;
  if (phpPath) {
    const out = await capture(exec, phpPath, ['-v']);
    version = parsePhpVersion(`${out.stdout}\n${out.stderr}`);
  }

  const base = { version, phpPath, fastcgi };

  if (!phpPath && !fastcgi) {
    return {
      ...base,
      ok: false,
      status: 'fail',
      message: 'PHP / php-fpm not found',
      detail: hint,
    };
  }
  if (phpPath && !version) {
    return {
      ...base,
      ok: false,
      status: 'warn',
      message: `PHP found (${plainLine(phpPath)}) but the version could not be read (need 8.2 or newer)`,
      detail: hint,
    };
  }
  if (version && !phpVersionOk(version)) {
    return {
      ...base,
      ok: false,
      status: 'warn',
      message: `PHP ${version.label} is older than 8.2`,
      detail: hint,
    };
  }
  if (!fastcgi) {
    return {
      ...base,
      ok: false,
      status: 'warn',
      message: `PHP ${version ? version.label : 'found'} (${plainLine(phpPath)}) but neither php-fpm nor php-cgi was found`,
      detail: `Caddy php_fastcgi uses 127.0.0.1:9000. ${hint}`,
    };
  }
  if (!phpPath || !version) {
    return {
      ...base,
      ok: false,
      status: 'warn',
      message: `${fastcgiLabel} found (${plainLine(fastcgi)}) but the php CLI was not found, so the version was not checked (need 8.2 or newer)`,
      detail: hint,
    };
  }
  return {
    ...base,
    ok: true,
    status: 'ok',
    message: `PHP ${version.label} and ${fastcgiLabel} found (${plainLine(fastcgi)}; php=${plainLine(phpPath)})`,
    detail: '',
  };
}

/**
 * @param {string} name validated project name
 */
export function phpOriginsHint(name) {
  const safe = plainLine(name).replace(/[^a-z0-9-]/gi, '') || 'your-project';
  return `Copy api/.env.example to .env in the project root (do not commit .env). Set ALLOWED_ORIGINS to exact origins with no trailing slash, including https://${safe}.sp`;
}

/**
 * Warning for new / dev / watch. Does not include a stack trace.
 * @param {{ message: string, detail?: string }} result
 * @param {string} [domain] linked name.sp
 */
export function phpProjectWarning(result, domain) {
  const host = plainLine(domain).replace(/[^a-z0-9.-]/gi, '') || '<project>.sp';
  const lines = [result.message];
  if (result.detail) lines.push(result.detail);
  lines.push(
    `JavaScript build and live reload will continue. https://${host}/api/action.php needs PHP before it can answer.`
  );
  return lines.join('\n');
}

/**
 * Warn when this project opted into PHP and the runtime is missing or too old.
 * Does not throw and does not stop the JS build.
 *
 * @param {string} cwd
 * @param {object} [opts]
 * @param {typeof fs} [opts.fs]
 * @param {import('./exec.js').ExecFn} [opts.exec]
 * @param {(msg: string) => void} [opts.warn]
 * @param {string} [opts.domain]
 * @param {boolean} [opts.ensure] start php-fpm when the runtime looks usable
 */
export async function warnPhpProject(cwd, opts = {}) {
  const fse = opts.fs || fs;
  const warn = opts.warn || (() => {});
  let data = null;
  try {
    const sp = await readStagepassJson(cwd, fse);
    data = sp.data;
  } catch {
    return { applicable: false };
  }
  if (phpFromStagepassConfig(data) !== true) return { applicable: false };

  let result;
  try {
    result = await checkPhpRuntime(opts);
  } catch {
    warn('PHP could not be checked. JavaScript build and live reload will continue.');
    return { applicable: true, ok: false };
  }
  if (!result.ok) {
    warn(phpProjectWarning(result, opts.domain));
    return { applicable: true, ok: false, result };
  }
  if (opts.ensure !== false) {
    const ensure = opts.ensurePhpFpm || defaultEnsurePhpFpm;
    try {
      const started = await ensure({ exec: opts.exec, stdio: 'ignore' });
      if (!started || started.ok === false) {
        const detail = plainLine(started && started.detail);
        warn(
          detail
            ? `PHP-FPM was not started (${detail}). JavaScript build and live reload will continue.`
            : 'PHP-FPM was not started. JavaScript build and live reload will continue.'
        );
      }
    } catch {
      warn('PHP-FPM was not started. JavaScript build and live reload will continue.');
    }
  }
  return { applicable: true, ok: true, result };
}
