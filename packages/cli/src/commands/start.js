import chalk from 'chalk';
import path from 'path';
import fs from 'fs-extra';
import ora from 'ora';
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
import { loadProjects } from '../lib/projects.js';
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

/**
 * @param {{ pid: string, name: string }} proc
 * @param {object} opts
 * @param {import('../lib/exec.js').ExecFn} opts.exec
 * @param {(message: string, o?: object) => Promise<boolean>} opts.confirm
 * @param {(ms: number) => Promise<void>} [opts.sleep]
 * @param {() => Promise<{ pid: string, name: string }|null>} [opts.recheck]
 * @returns {Promise<{ ok: boolean, cancelled?: boolean, detail?: string }>}
 */
export async function resolvePort443Conflict(proc, opts) {
  const exec = opts.exec;
  const confirm = opts.confirm;
  const sleep =
    opts.sleep || ((ms) => new Promise((r) => setTimeout(r, ms)));
  const recheck = opts.recheck || (() => findPort443Conflict({ exec }));
  const pid = String(proc?.pid ?? '');

  if (!/^[1-9][0-9]*$/.test(pid)) {
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

  const shouldStop = await confirm(
    `Send SIGTERM to ${proc.name} (PID ${pid}) to free port 443?`,
    { default: false }
  );
  if (!shouldStop) {
    return { ok: false, cancelled: true };
  }

  try {
    await exec('sudo', ['-v'], { stdio: 'inherit' });
  } catch {
    return { ok: false, detail: 'sudo required to signal the conflicting process.' };
  }

  // Prefer graceful service stops for known local stacks, still only after confirm.
  if (proc.name.includes('nginx')) {
    try {
      await exec('valet', ['stop']);
      return { ok: true, detail: 'valet stop' };
    } catch {
      try {
        await exec('brew', ['services', 'stop', 'nginx']);
        return { ok: true, detail: 'brew services stop nginx' };
      } catch {
        // fall through to signals
      }
    }
  }
  if (proc.name.includes('httpd')) {
    try {
      await exec('sudo', ['apachectl', 'stop']);
      return { ok: true, detail: 'apachectl stop' };
    } catch {
      // fall through
    }
  }

  try {
    await exec('sudo', ['kill', '-TERM', pid]);
  } catch (error) {
    return {
      ok: false,
      detail: error instanceof Error ? error.message : String(error),
    };
  }

  await sleep(2000);
  const still = await recheck();
  if (!still || String(still.pid) !== pid) {
    return { ok: true, detail: 'SIGTERM' };
  }

  const escalate = await confirm(
    `${proc.name} (PID ${pid}) is still listening. Send SIGKILL?`,
    { default: false }
  );
  if (!escalate) {
    return { ok: false, cancelled: true, detail: 'SIGTERM sent; process still alive.' };
  }

  try {
    await exec('sudo', ['kill', '-KILL', pid]);
    return { ok: true, detail: 'SIGKILL' };
  } catch (error) {
    return {
      ok: false,
      detail: error instanceof Error ? error.message : String(error),
    };
  }
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
      console.log(chalk.dim('Certificates: ok'));
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

  // 2. Port conflict (no sudo until the user confirms a kill)
  const conflict =
    (await (options.findPort443Conflict || findPort443Conflict)({ exec })) ||
    null;
  if (conflict) {
    if (!interactive) {
      console.log(
        chalk.red(
          `Port 443 is blocked by ${conflict.name} (PID ${conflict.pid}). Refusing to kill without confirmation.`
        )
      );
      return;
    }
    const resolved = await (options.resolvePort443Conflict ||
      resolvePort443Conflict)(conflict, { exec, confirm, sleep: options.sleep });
    if (!resolved.ok) {
      if (resolved.detail) console.log(chalk.red(resolved.detail));
      return;
    }
    console.log(chalk.green(`Port freed (${resolved.detail}).`));
  }

  // 3. Migrate legacy Caddyfile blocks before boot
  await fs.ensureDir(caddyDir);
  if (await fs.pathExists(caddyFile)) {
    await ensureCaddyfileMigrated({ caddyfilePath: caddyFile, projectsPath });
    await warnIfAllowAllOriginsActive({ caddyfilePath: caddyFile });
  }

  // 4. Boot services (autostart-aware)
  const spinner = ora('Booting background services...').start();

  let stdioMode = 'ignore';
  if (options.verbose) {
    spinner.stop();
    console.log(chalk.dim('--- Verbose Logs ---'));
    stdioMode = 'inherit';
  } else {
    const logStream = fs.openSync(logFile, 'w');
    stdioMode = ['ignore', logStream, logStream];
  }

  try {
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
          return;
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
        return;
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
  } catch (error) {
    if (!options.verbose) spinner.fail('Failed to start.');
    else console.log(chalk.red('Failed to start.'));
    if (!options.verbose) {
      console.log(chalk.red('See error log for details:'));
      console.log(chalk.dim(logFile));
    } else if (error instanceof Error) {
      console.log(chalk.red(error.message));
    }
  }
}
