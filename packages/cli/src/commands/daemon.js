import fs from 'fs-extra';
import chalk from 'chalk';
import { defaultExec } from '../lib/exec.js';
import { getCaddyfilePath, getLogsDir } from '../lib/paths.js';
import { runCertsCheck } from '../lib/certs.js';
import { loadProjects } from '../lib/projects.js';
import { getProjectsPath } from '../lib/paths.js';

/**
 * Detect bind / permission failures that will not self-heal on immediate restart.
 * LaunchAgent KeepAlive (SuccessfulExit=false) must not restart-loop on these.
 * @param {string} detail
 * @returns {boolean}
 */
export function isPermanentDaemonFailure(detail) {
  return /permission denied|bind|address already in use|EADDRINUSE|EACCES/i.test(
    String(detail || '')
  );
}

/**
 * Non-interactive foreground daemon for LaunchAgent use.
 * Never uses sudo. Runs certs check (log only, no TLS handshake), then `caddy run`.
 *
 * Existing `stagepass start` also launches Caddy as the user (sudo is only for
 * port conflict helpers). Binding TCP 443 as a user LaunchAgent is therefore
 * expected to work on macOS the same way. Permanent startup failures (missing
 * Caddyfile, port 443 bind) exit 0 after logging so launchd KeepAlive does not
 * restart-loop; unexpected mid-run failures exit 1 so KeepAlive can retry.
 *
 * @param {object} [options]
 * @param {import('../lib/exec.js').ExecFn} [options.exec]
 * @param {(file: string, args: string[], opts?: object) => Promise<unknown>} [options.runForeground]
 * @param {(msg: string) => void} [options.log]
 * @returns {Promise<number>}
 */
export async function daemon(options = {}) {
  const log =
    options.log ||
    ((msg) => {
      const line = `[stagepass daemon] ${msg}`;
      console.error(line);
    });

  const exec = options.exec || defaultExec;
  const caddyfilePath = options.caddyfilePath || getCaddyfilePath();
  const pathExists = options.pathExists || ((p) => fs.pathExists(p));

  await fs.ensureDir(options.logsDir || getLogsDir());

  if (!(await pathExists(caddyfilePath))) {
    log(`Caddyfile missing: ${caddyfilePath}`);
    log('Refusing to start. Run: stagepass setup && stagepass link');
    // Exit 0: permanent until the user fixes config; avoid KeepAlive restart loop.
    return 0;
  }

  // Non-interactive cert check (log only; never prompts; never repairs).
  // Skip TLS handshakes: Caddy is not running yet during cold start.
  try {
    const projectsPath = options.projectsPath || getProjectsPath();
    const doc = await loadProjects(projectsPath);
    const domains = Object.keys(doc.projects || {});
    const report = await runCertsCheck({
      exec,
      domains,
      skipHandshake: true,
      handshakeTimeoutMs: 2000,
    });
    log(`certs root: ${report.root.status} ${report.root.reason}`);
    log(
      `certs trust: ${report.trust?.trusted ? 'trusted' : 'NOT trusted'}${
        report.trust?.error ? ` (${report.trust.error})` : ''
      }`
    );
    if (report.orphans?.length) {
      log(
        `certs orphans: ${report.orphans.length} (report only; SHA-1 ${report.orphans
          .map((o) => o.sha1 || '?')
          .join(', ')})`
      );
    }
  } catch (error) {
    log(
      `certs check failed (continuing): ${
        error instanceof Error ? error.message : String(error)
      }`
    );
  }

  const args = ['run', '--config', caddyfilePath, '--adapter', 'caddyfile'];
  log(`starting: caddy ${args.join(' ')}`);

  const runForeground =
    options.runForeground ||
    (async (file, fileArgs) => {
      // Inherit stdio so LaunchAgent log redirects capture Caddy output.
      return exec(file, fileArgs, { stdio: 'inherit' });
    });

  try {
    await runForeground('caddy', args);
    log('caddy exited cleanly');
    return 0;
  } catch (error) {
    const err = /** @type {{ message?: string, stderr?: string, code?: string|number }} */ (
      error
    );
    const detail = [err.message, err.stderr].filter(Boolean).join(' | ');
    log(`caddy failed: ${detail}`);
    if (isPermanentDaemonFailure(detail)) {
      log(
        'Port 443 bind/listen failed for the user LaunchAgent. Exiting without KeepAlive retry. Use interactive `stagepass start` (which can resolve conflicts with confirmation), or free port 443, then retry.'
      );
      if (process.stderr.isTTY) {
        console.error(chalk.red(detail));
      }
      // Exit 0 so SuccessfulExit=false KeepAlive does not restart-loop.
      return 0;
    }
    if (process.stderr.isTTY) {
      console.error(chalk.red(detail));
    }
    return 1;
  }
}
