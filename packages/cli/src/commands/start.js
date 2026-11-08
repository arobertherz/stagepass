import { execa as defaultExeca } from 'execa';
import chalk from 'chalk';
import path from 'path';
import fs from 'fs-extra';
import os from 'node:os';
import inquirer from 'inquirer';
import { createSpinner } from '../lib/spinner.js';
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
import { parseLsofListenOutput } from '../lib/doctor.js';
import {
  getAutostartStatus,
  buildLaunchctlBootstrapArgs,
  buildLaunchctlKickstartArgs,
  LAUNCH_AGENT_LABEL,
} from '../lib/autostart.js';

const PORT_IGNORE = [
  'Google Chrome',
  'Chrome Helper',
  'OneDrive',
  'Music',
  'Safari',
  'caddy',
];

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
 * @param {typeof defaultExeca} [opts.execa]
 * @returns {Promise<{ pid: string, name: string }|null>}
 */
export async function findPort443Conflict(opts = {}) {
  const run = opts.execa || defaultExeca;
  try {
    const { stdout } = await run('lsof', [
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
    const err = /** @type {{ exitCode?: number, code?: string|number }} */ (error);
    // lsof exits 1 when nothing matches
    if (err.exitCode === 1 || err.code === 1 || err.code === '1') return null;
    return null;
  }
}

/**
 * @param {object} opts
 * @param {string} opts.message
 * @param {boolean} [opts.default]
 * @param {(message: string, o?: { default?: boolean }) => Promise<boolean>} [opts.confirm]
 * @param {boolean} [opts.interactive]
 */
async function askConfirm(opts) {
  if (typeof opts.confirm === 'function') {
    return opts.confirm(opts.message, { default: opts.default === true });
  }
  if (opts.interactive === false || !process.stdin.isTTY) {
    return false;
  }
  const { value } = await inquirer.prompt([
    {
      type: 'confirm',
      name: 'value',
      message: opts.message,
      default: opts.default === true,
    },
  ]);
  return Boolean(value);
}

/**
 * Send a signal; use sudo only if the unprivileged kill fails.
 * @param {string} pid
 * @param {'TERM'|'KILL'} signal
 * @param {typeof defaultExeca} run
 */
async function signalProcess(pid, signal, run) {
  const flag = signal === 'KILL' ? '-KILL' : '-TERM';
  try {
    await run('kill', [flag, pid]);
    return { ok: true, usedSudo: false };
  } catch {
    await run('sudo', ['kill', flag, pid], { stdio: 'inherit' });
    return { ok: true, usedSudo: true };
  }
}

/**
 * Resolve a confirmed port conflict: TERM first, KILL only after a second confirm
 * if the listener is still present. Never signals without confirmation.
 *
 * @param {{ pid: string, name: string }} proc
 * @param {object} opts
 * @param {typeof defaultExeca} [opts.execa]
 * @param {(message: string, o?: { default?: boolean }) => Promise<boolean>} [opts.confirm]
 * @param {boolean} [opts.interactive]
 * @param {(ms: number) => Promise<void>} [opts.sleep]
 * @param {() => Promise<{ pid: string, name: string }|null>} [opts.recheck]
 * @returns {Promise<{ ok: boolean, cancelled?: boolean, detail?: string }>}
 */
export async function resolvePort443Conflict(proc, opts = {}) {
  const run = opts.execa || defaultExeca;
  const sleep =
    opts.sleep || ((ms) => new Promise((r) => setTimeout(r, ms)));
  const recheck = opts.recheck || (() => findPort443Conflict({ execa: run }));
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

  const shouldTerm = await askConfirm({
    message: `Send SIGTERM to ${proc.name} (PID ${pid}) to free port 443?`,
    default: false,
    confirm: opts.confirm,
    interactive: opts.interactive,
  });
  if (!shouldTerm) {
    return { ok: false, cancelled: true };
  }

  // Prefer service stop helpers when the name is a known reverse proxy / httpd.
  if (String(proc.name).includes('nginx')) {
    try {
      await run('valet', ['stop']);
    } catch {
      try {
        await run('brew', ['services', 'stop', 'nginx']);
      } catch {
        await signalProcess(pid, 'TERM', run);
      }
    }
  } else if (String(proc.name).includes('httpd')) {
    try {
      await run('sudo', ['apachectl', 'stop'], { stdio: 'inherit' });
    } catch {
      await signalProcess(pid, 'TERM', run);
    }
  } else {
    await signalProcess(pid, 'TERM', run);
  }

  await sleep(400);
  let still = await recheck();
  if (!still || String(still.pid) !== pid) {
    return { ok: true, detail: 'SIGTERM' };
  }

  const shouldKill = await askConfirm({
    message: `${proc.name} (PID ${pid}) is still listening. Send SIGKILL?`,
    default: false,
    confirm: opts.confirm,
    interactive: opts.interactive,
  });
  if (!shouldKill) {
    return {
      ok: false,
      cancelled: true,
      detail: 'Still listening after SIGTERM; SIGKILL not confirmed.',
    };
  }

  await signalProcess(pid, 'KILL', run);
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
 * @param {object} [options]
 * @param {boolean} [options.verbose]
 * @param {typeof defaultExeca} [options.execa]
 * @param {(message: string, o?: { default?: boolean }) => Promise<boolean>} [options.confirm]
 * @param {boolean} [options.interactive]
 * @param {typeof getAutostartStatus} [options.getAutostartStatus]
 * @param {typeof findPort443Conflict} [options.findPort443Conflict]
 * @param {typeof resolvePort443Conflict} [options.resolvePort443Conflict]
 * @param {number} [options.uid]
 * @param {(ms: number) => Promise<void>} [options.sleep]
 */
export async function start(options = {}) {
  const run = options.execa || defaultExeca;
  const interactive =
    options.interactive !== undefined
      ? options.interactive
      : Boolean(process.stdin.isTTY);
  const caddyDir = getStagepassDir();
  const caddyFile = getCaddyfilePath();
  const logFile = getServerLogPath();
  const projectsPath = getProjectsPath();

  console.log(chalk.bold('\n🚀 Starting Stagepass...'));

  // 1. Port conflict — no sudo until the user confirms a signal that needs it.
  const conflict =
    (await (options.findPort443Conflict || findPort443Conflict)({
      execa: run,
    })) || null;
  if (conflict) {
    if (!interactive && typeof options.confirm !== 'function') {
      console.log(
        chalk.red(
          `Port 443 is blocked by ${conflict.name} (PID ${conflict.pid}). Refusing to signal without confirmation.`
        )
      );
      return;
    }
    const resolved = await (options.resolvePort443Conflict ||
      resolvePort443Conflict)(conflict, {
      execa: run,
      confirm: options.confirm,
      interactive,
      sleep: options.sleep,
    });
    if (!resolved.ok) {
      if (resolved.detail) console.log(chalk.red(resolved.detail));
      return;
    }
    console.log(chalk.green(`Port freed (${resolved.detail}).`));
  }

  // 2. Migrate legacy Caddyfile blocks before boot
  await fs.ensureDir(caddyDir);
  if (await fs.pathExists(caddyFile)) {
    await ensureCaddyfileMigrated({ caddyfilePath: caddyFile, projectsPath });
    await warnIfAllowAllOriginsActive({ caddyfilePath: caddyFile });
  }

  // 3. Boot services (autostart-aware kickstart when LaunchAgent is installed)
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
    // PHP: preserve public brew services restart (no root warm-up).
    try {
      await run('brew', ['services', 'restart', 'php'], {
        stdio: stdioMode === 'inherit' ? 'inherit' : 'ignore',
      });
    } catch {
      /* ignore php errors */
    }

    /** @type {{ loaded?: boolean, plistExists?: boolean, plistPath?: string }} */
    let status = {};
    try {
      status =
        (await (options.getAutostartStatus || getAutostartStatus)({})) || {};
    } catch {
      status = {};
    }
    const uid = options.uid ?? process.getuid?.() ?? os.userInfo().uid;

    if (status.loaded || status.plistExists) {
      if (status.plistExists && !status.loaded && status.plistPath) {
        try {
          await run(
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
        await run('launchctl', buildLaunchctlKickstartArgs(uid));
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

    try {
      await run('caddy', ['stop']);
    } catch {
      /* ignore */
    }

    await run('caddy', ['start', '--config', caddyFile], { stdio: stdioMode });

    if (!options.verbose) {
      spinner.succeed(chalk.green('Stagepass is active.'));
      console.log(chalk.dim(`   Logs: ${logFile}`));
    } else {
      console.log(chalk.green('✔ Stagepass is active.'));
    }
  } catch (error) {
    spinner.fail('Failed to start.');
    if (!options.verbose) {
      console.log(chalk.red('See error log for details:'));
      console.log(chalk.dim(logFile));
    } else if (error instanceof Error) {
      console.log(chalk.red(error.message));
    }
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
