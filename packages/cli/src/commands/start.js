import chalk from 'chalk';
import path from 'path';
import fs from 'fs-extra';
import { createSpinner } from '../lib/spinner.js';
import os from 'node:os';
import {
  getCaddyfilePath,
  getServerLogPath,
  getStagepassDir,
  getProjectsPath,
} from '../lib/paths.js';
import {
  ensureCaddyfileMigrated,
  warnIfAllowAllOriginsActive,
} from '../lib/migrate.js';
import { defaultExec } from '../lib/exec.js';
import { confirm as defaultConfirm } from '../lib/prompts.js';
import { parseLsofListenOutput } from '../lib/doctor.js';
import { runCertsCheck, domainsNeedingSiteCertRenewal } from '../lib/certs.js';
import { loadProjects, clearStaleDevPorts, getProject } from '../lib/projects.js';
import { applySiteBlock } from '../lib/apply-site-block.js';
import {
  getAutostartStatus,
  buildLaunchctlKickstartArgs,
  buildLaunchctlBootstrapArgs,
  LAUNCH_AGENT_LABEL,
} from '../lib/autostart.js';
import { ensurePhpFpm } from '../lib/php-fpm.js';
import { certsTrust, certsRenew } from './certs.js';

const PORT_IGNORE = ['Google Chrome', 'Chrome Helper', 'OneDrive', 'Music', 'Safari', 'caddy'];

/**
 * @param {unknown} pid
 * @returns {boolean}
 */
export function isSafePid(pid) {
  return typeof pid === 'string'
    ? /^[1-9][0-9]*$/.test(pid)
    : typeof pid === 'number' && Number.isInteger(pid) && pid > 0;
}

/**
 * Inspect TCP 443 without sudo (same approach as doctor).
 * @param {object} [opts]
 * @param {import('../lib/exec.js').ExecFn} [opts.exec]
 * @returns {Promise<{ pid: string, name: string }|null>}
 */
export async function findPort443Conflict(opts = {}) {
  const exec = opts.exec || defaultExec;
  try {
    const { stdout } = await exec('lsof', [
      '-nP',
      '-iTCP:443',
      '-sTCP:LISTEN',
    ]);
    const listeners = parseLsofListenOutput(stdout);
    for (const listener of listeners) {
      const name = listener.name || path.basename(listener.command || '');
      if (PORT_IGNORE.some((ignore) => name.includes(ignore))) continue;
      if (/^caddy$/i.test(name)) continue;
      return { pid: String(listener.pid), name };
    }
    return null;
  } catch (error) {
    const err = /** @type {{ code?: string|number }} */ (error);
    if (err.code === 1 || err.code === '1') return null;
    return null;
  }
}

/** process.kill; sudo kill only on EPERM. ESRCH=ok; else ok:false (no throw). */
async function signalProcess(pid, signal, exec, kill = process.kill) {
  try {
    kill(Number(pid), /** @type {NodeJS.Signals} */ (`SIG${signal}`));
    return { ok: true };
  } catch (e) {
    const code = /** @type {{ code?: string }} */ (e)?.code;
    if (code === 'ESRCH') return { ok: true };
    if (code !== 'EPERM') {
      return { ok: false, detail: `Failed to signal PID ${pid}: ${e?.message ?? e}` };
    }
  }
  try {
    await exec('sudo', ['kill', signal === 'KILL' ? '-KILL' : '-TERM', pid], {
      stdio: 'inherit',
    });
    return { ok: true };
  } catch (e) {
    return { ok: false, detail: `sudo kill failed for PID ${pid}: ${e?.message ?? e}` };
  }
}

/**
 * Resolve a confirmed port conflict: TERM first, KILL only after a second confirm
 * if the listener is still present. Never signals without confirmation.
 * Privilege-scoped: own processes without sudo; sudo only after unprivileged failure.
 *
 * @param {{ pid: string, name: string }} proc
 * @param {object} opts
 * @param {import('../lib/exec.js').ExecFn} [opts.exec]
 * @param {typeof process.kill} [opts.kill]
 * @param {(message: string, o?: object) => Promise<boolean>} [opts.confirm]
 * @param {boolean} [opts.interactive]
 * @param {(ms: number) => Promise<void>} [opts.sleep]
 * @param {() => Promise<{ pid: string, name: string }|null>} [opts.recheck]
 * @returns {Promise<{ ok: boolean, cancelled?: boolean, detail?: string }>}
 */
export async function resolvePort443Conflict(proc, opts = {}) {
  const exec = opts.exec || defaultExec;
  const kill = opts.kill || process.kill;
  const confirm = opts.confirm || defaultConfirm;
  const sleep =
    opts.sleep || ((ms) => new Promise((r) => setTimeout(r, ms)));
  const recheck = opts.recheck || (() => findPort443Conflict({ exec }));
  const pid = String(proc?.pid ?? '');

  if (!isSafePid(pid)) {
    return {
      ok: false,
      detail: `Refusing to signal process: invalid PID "${proc?.pid}".`,
    };
  }

  console.log(
    chalk.yellow(
      `\n⚠️  Port 443 is blocked by: ${chalk.bold(proc.name)} (PID ${pid})`
    )
  );

  const shouldTerm = await confirm(
    `Send SIGTERM to ${proc.name} (PID ${pid}) to free port 443?`,
    { default: false }
  );
  if (!shouldTerm) {
    return { ok: false, cancelled: true };
  }

  let signaled;
  // Prefer right-free service stops before any sudo (nginx: valet, then brew).
  if (String(proc.name).includes('nginx')) {
    try {
      await exec('valet', ['stop']);
    } catch {
      try {
        await exec('brew', ['services', 'stop', 'nginx']);
      } catch {
        signaled = await signalProcess(pid, 'TERM', exec, kill);
      }
    }
  } else if (String(proc.name).includes('httpd')) {
    try {
      await exec('sudo', ['apachectl', 'stop'], { stdio: 'inherit' });
    } catch {
      signaled = await signalProcess(pid, 'TERM', exec, kill);
    }
  } else {
    signaled = await signalProcess(pid, 'TERM', exec, kill);
  }
  if (signaled?.ok === false) return signaled;

  await sleep(400);
  let still = await recheck();
  if (!still || String(still.pid) !== pid) {
    return { ok: true, detail: 'SIGTERM' };
  }

  const shouldKill = await confirm(
    `${proc.name} (PID ${pid}) is still listening. Send SIGKILL?`,
    { default: false }
  );
  if (!shouldKill) {
    return {
      ok: false,
      cancelled: true,
      detail: 'Still listening after SIGTERM; SIGKILL not confirmed.',
    };
  }

  const killed = await signalProcess(pid, 'KILL', exec, kill);
  if (!killed.ok) return killed;
  await sleep(200);
  still = await recheck();
  if (still && String(still.pid) === pid) {
    return {
      ok: false,
      detail: `PID ${pid} still listening after SIGKILL.`,
    };
  }
  return { ok: true, detail: 'SIGKILL' };
}

/**
 * Summarize cert findings for start output.
 * @param {Awaited<ReturnType<typeof runCertsCheck>>} report
 */
export function summarizeCertFindings(report) {
  const issues = [];
  if (report.root?.status === 'fail') {
    issues.push({ kind: 'root', message: report.root.reason });
  }
  if (report.trust && !report.trust.trusted) {
    issues.push({ kind: 'trust', message: 'Caddy local root is not trusted in the System keychain' });
  }
  const needing = domainsNeedingSiteCertRenewal(report.handshakes || []);
  for (const domain of needing) {
    issues.push({ kind: 'site', domain, message: `TLS fail for ${domain}` });
  }
  if (report.orphans?.length) {
    issues.push({
      kind: 'orphans',
      message: `${report.orphans.length} orphaned Caddy root(s) in keychain (certs renew --remove-orphans)`,
    });
  }
  return issues;
}

/**
 * Honest one-line cert summary when nothing failed hard enough to offer repair.
 * Never says "ok" for a root or a site check that did not run or was not ok.
 * The Caddy :443 reason is included only when every skip came from that check.
 * @param {{ root?: { status?: string }, handshakes?: { status?: string, reason?: string }[] }} report
 */
function certStatusLine(report) {
  const root = report?.root?.status;
  const rootLabel =
    root === 'ok' ? 'root ok' : root === 'warn' ? 'root warning' : 'root not checked';
  const hs = report?.handshakes || [];
  if (!hs.length) return `Certificates: ${rootLabel}, site TLS not checked.`;
  const skips = hs.filter((h) => h.status === 'skip');
  if (skips.length) {
    const why = skips.every((h) => /not serving :443/.test(String(h.reason || '')))
      ? ' (Caddy not serving :443)'
      : '';
    return `Certificates: ${rootLabel}, site TLS not checkable${why}.`;
  }
  const sitesOk = hs.every((h) => h.status === 'ok');
  if (root === 'ok' && sitesOk) return 'Certificates: ok';
  return `Certificates: ${rootLabel}, site TLS ${sitesOk ? 'ok' : 'not ok'}.`;
}

/**
 * @param {object} [options]
 */
export async function start(options = {}) {
  const caddyDir = getStagepassDir();
  const caddyFile = getCaddyfilePath();
  const logFile = getServerLogPath();
  const projectsPath = getProjectsPath();
  const exec = options.exec || defaultExec;
  const confirm = options.confirm || defaultConfirm;
  const interactive =
    options.interactive === true ||
    (options.interactive !== false &&
      (typeof options.confirm === 'function' || process.stdin.isTTY));

  console.log(chalk.bold('\n🚀 Starting Stagepass...'));

  // 1. Read-only certs check (always)
  let certReport = null;
  try {
    const doc = await loadProjects(projectsPath);
    const domains = Object.keys(doc.projects || {});
    certReport = await (options.runCertsCheck || runCertsCheck)({
      exec,
      domains,
      skipHandshake: options.skipHandshake === true,
    });
    const findings = summarizeCertFindings(certReport);
    if (findings.length > 0) {
      console.log(chalk.yellow('\nCertificate findings:'));
      for (const f of findings) {
        console.log(chalk.yellow(`  • ${f.message}`));
      }
      if (interactive) {
        const trustIssue = findings.some((f) => f.kind === 'trust');
        const siteIssue = findings.some((f) => f.kind === 'site');
        if (trustIssue) {
          const doTrust = await confirm('Run `stagepass certs trust` now?', {
            default: false,
          });
          if (doTrust) {
            await (options.certsTrust || certsTrust)({
              yes: true,
              exec,
            });
          }
        }
        if (siteIssue) {
          const doRenew = await confirm(
            'Run `stagepass certs renew` for failing site certificates?',
            { default: false }
          );
          if (doRenew) {
            await (options.certsRenew || certsRenew)({
              yes: true,
              exec,
              confirm,
            });
          }
        }
      } else {
        console.log(
          chalk.dim(
            'Non-interactive start: fix with `stagepass certs trust` / `stagepass certs renew` (and `--remove-orphans` / `--root` when needed).'
          )
        );
      }
    } else {
      console.log(chalk.dim(certStatusLine(certReport)));
    }
  } catch (error) {
    console.log(
      chalk.yellow(
        `Certificate check skipped: ${
          error instanceof Error ? error.message : String(error)
        }`
      )
    );
  }

  // 2. Port conflict (no sudo until a confirmed signal needs it; never sudo -v)
  const conflict =
    (await (options.findPort443Conflict || findPort443Conflict)({ exec })) ||
    null;
  if (conflict) {
    if (!interactive && typeof options.confirm !== 'function') {
      console.log(
        chalk.red(
          `Port 443 is blocked by ${conflict.name} (PID ${conflict.pid}). Refusing to signal without confirmation.`
        )
      );
      return 1;
    }
    const resolved = await (options.resolvePort443Conflict ||
      resolvePort443Conflict)(conflict, {
      exec,
      kill: options.kill,
      confirm,
      interactive,
      sleep: options.sleep,
    });
    if (!resolved.ok) {
      if (resolved.detail) console.log(chalk.red(resolved.detail));
      return 1;
    }
    console.log(chalk.green(`Port freed (${resolved.detail}).`));
  }

  // 3. Migrate legacy Caddyfile blocks before boot; drop dead live-reload ports
  await fs.ensureDir(caddyDir);
  if (await fs.pathExists(caddyFile)) {
    await ensureCaddyfileMigrated({ caddyfilePath: caddyFile, projectsPath });
    const stale = await clearStaleDevPorts(projectsPath);
    for (const domain of stale) {
      const project = await getProject(domain, projectsPath);
      if (project) {
        await applySiteBlock(domain, project, { caddyfilePath: caddyFile });
      }
    }
    await warnIfAllowAllOriginsActive({ caddyfilePath: caddyFile });
  }

  // 4. Boot services (autostart-aware)
  const spinner = createSpinner('Booting background services...').start();

  /** @type {number|null} */
  let logFd = null;
  let stdioMode = 'ignore';
  if (options.verbose) {
    spinner.stop();
    console.log(chalk.dim('--- Verbose Logs ---'));
    stdioMode = 'inherit';
  } else {
    logFd = fs.openSync(logFile, 'w');
    stdioMode = ['ignore', logFd, logFd];
  }

  try {
    // 2.3: ensurePhpFpm prefers `brew services start php`, then `restart`
    // (2.2.7 always used `restart`). Keep start-first; both stay non-sudo.
    const php = await ensurePhpFpm({
      exec,
      stdio: stdioMode === 'inherit' ? 'inherit' : 'ignore',
    });
    if (!php.ok && options.verbose) {
      console.log(chalk.yellow(`PHP-FPM: ${php.detail || 'failed'}`));
    }

    const status =
      (await (options.getAutostartStatus || getAutostartStatus)({ exec })) ||
      {};
    const uid = options.uid ?? process.getuid?.() ?? os.userInfo().uid;

    if (status.loaded || status.plistExists) {
      if (status.plistExists && !status.loaded) {
        try {
          await exec(
            'launchctl',
            buildLaunchctlBootstrapArgs(uid, status.plistPath)
          );
          console.log(
            chalk.dim(
              `Bootstrapped LaunchAgent ${LAUNCH_AGENT_LABEL} (was installed but not loaded).`
            )
          );
        } catch (error) {
          if (!options.verbose) spinner.fail('Failed to bootstrap LaunchAgent.');
          console.log(
            chalk.red(error instanceof Error ? error.message : String(error))
          );
          return 1;
        }
      }
      try {
        await exec('launchctl', buildLaunchctlKickstartArgs(uid));
        if (!options.verbose) {
          spinner.succeed(
            chalk.green(
              `Stagepass is active (launchctl kickstart ${LAUNCH_AGENT_LABEL}).`
            )
          );
          console.log(chalk.dim(`   Logs: ${logFile}`));
        } else {
          console.log(
            chalk.green(`✔ kickstart gui/${uid}/${LAUNCH_AGENT_LABEL}`)
          );
        }
        return 0;
      } catch (error) {
        if (!options.verbose) spinner.fail('launchctl kickstart failed.');
        console.log(
          chalk.red(error instanceof Error ? error.message : String(error))
        );
        console.log(chalk.dim('Falling back to direct caddy start...'));
        if (!options.verbose) spinner.start('Booting background services...');
      }
    }

    // Direct caddy start (no LaunchAgent)
    try {
      await exec('caddy', ['stop'], { stdio: 'ignore' });
    } catch {
      // ignore
    }

    await exec('caddy', ['start', '--config', caddyFile], {
      stdio: stdioMode,
    });

    if (!options.verbose) {
      spinner.succeed(chalk.green('Stagepass is active.'));
      console.log(chalk.dim(`   Logs: ${logFile}`));
    } else {
      console.log(chalk.green('✔ Stagepass is active.'));
    }
    return 0;
  } catch (error) {
    if (!options.verbose) spinner.fail('Failed to start.');
    else console.log(chalk.red('Failed to start.'));
    if (!options.verbose) {
      console.log(chalk.red('See error log for details:'));
      console.log(chalk.dim(logFile));
    } else if (error instanceof Error) {
      console.log(chalk.red(error.message));
    }
    return 1;
  } finally {
    if (logFd != null) {
      try {
        fs.closeSync(logFd);
      } catch {
        /* ignore */
      }
    }
  }
}
