import fs from 'fs-extra';
import chalk from 'chalk';
import { defaultExec } from '../lib/exec.js';
import { getCaddyfilePath, getLogsDir } from '../lib/paths.js';
import { runCertsCheck } from '../lib/certs.js';
import { loadProjects } from '../lib/projects.js';
import { getProjectsPath } from '../lib/paths.js';

/**
 * Non-interactive foreground daemon for LaunchAgent use.
 * Never uses sudo. Runs certs check (log only), then `caddy run`.
 *
 * Existing `stagepass start` also launches Caddy as the user (sudo is only for
 * port conflict helpers). Binding TCP 443 as a user LaunchAgent is therefore
 * expected to work on macOS the same way. If bind fails, we exit with a clear
 * message rather than silently doing nothing.
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

  await fs.ensureDir(options.logsDir || getLogsDir());

  if (!(await fs.pathExists(caddyfilePath))) {
    log(`Caddyfile missing: ${caddyfilePath}`);
    log('Refusing to start. Run: stagepass setup && stagepass link');
    return 1;
  }

  // Non-interactive cert check (log only; never prompts; never repairs).
  try {
    const doc = await loadProjects(getProjectsPath());
    const domains = Object.keys(doc.projects || {});
    const report = await runCertsCheck({
      exec,
      domains,
      skipHandshake: false,
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
    for (const hs of report.handshakes || []) {
      log(`certs tls ${hs.servername}: ${hs.status} ${hs.reason}`);
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
    if (
      /permission denied|bind|address already in use|EADDRINUSE|EACCES/i.test(
        detail
      )
    ) {
      log(
        'Port 443 bind/listen failed for the user LaunchAgent. Use interactive `stagepass start` (which can resolve conflicts with confirmation), or free port 443, then retry.'
      );
    }
    // Avoid chalk in LaunchAgent logs when not a TTY, but keep message clear.
    if (process.stderr.isTTY) {
      console.error(chalk.red(detail));
    }
    return 1;
  }
}
