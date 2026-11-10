/**
 * `stagepass dev`: project watch build + live-reload SSE event server behind Caddy.
 * Does not add Vite to user projects (Webflow classic script order + hashed manifest).
 */

import fs from 'fs-extra';
import path from 'path';
import chalk from 'chalk';
import { execa } from 'execa';
import { spawn as nodeSpawn } from 'node:child_process';
import {
  findProjectByRoot,
  getProject,
  setProjectDevPort,
  clearStaleDevPorts,
} from '../lib/projects.js';
import { applySiteBlock } from '../lib/apply-site-block.js';
import { createLiveServer, resolveOutputDir } from '../lib/live-server.js';
import { readStagepassJson } from '../lib/project-sync.js';
import { getCaddyfilePath, getProjectsPath, validateRoot } from '../lib/paths.js';
import { isPidAlive, isValidDevPort } from '../lib/dev-port.js';
import { ensureStagepassReady } from '../lib/ensure-running.js';
import { start as defaultStart } from './start.js';

/** Grace before SIGKILL after a forwarded stop signal (overridable in tests). */
export const DEV_SIGNAL_GRACE_MS = 3000;

const SIGNAL_NUM = /** @type {const} */ ({ SIGHUP: 1, SIGINT: 2, SIGTERM: 15 });

/**
 * @param {NodeJS.Signals} signal
 * @returns {number}
 */
export function signalExitCode(signal) {
  return 128 + (SIGNAL_NUM[signal] || 15);
}

/**
 * Read optional outDir from stagepass.json (default dist).
 * @param {string} cwd
 * @param {typeof fs} [fse]
 */
export async function readProjectOutDir(cwd, fse = fs) {
  const stagepass = await readStagepassJson(cwd, fse);
  const raw = stagepass.data && typeof stagepass.data.outDir === 'string' ? stagepass.data.outDir : 'dist';
  return resolveOutputDir(cwd, raw);
}

/**
 * @param {object} [options]
 * @param {boolean} [options.verbose]
 * @param {boolean} [options.yes]
 * @param {object} [deps]
 * @returns {Promise<number>}
 */
export async function dev(options = {}, deps = {}) {
  const log = deps.log || console.log;
  const error = deps.error || console.error;
  const fse = deps.fs || fs;
  const cwd = deps.cwd || options.cwd || process.cwd();
  const projectsPath = deps.projectsPath || getProjectsPath();
  const caddyfilePath = deps.caddyfilePath || getCaddyfilePath();
  const reloadCaddy =
    deps.reloadCaddy ||
    (async (cfgPath, verbose) => {
      await execa('caddy', ['reload', '--config', cfgPath], {
        stdio: verbose ? 'inherit' : 'ignore',
      });
    });
  const createServer = deps.createLiveServer || createLiveServer;
  const spawnWatch = deps.spawnWatch || defaultSpawnWatch;
  const graceMs = typeof deps.signalGraceMs === 'number' ? deps.signalGraceMs : DEV_SIGNAL_GRACE_MS;

  const rootCheck = validateRoot(cwd);
  if (!rootCheck.ok) {
    error(chalk.red(`❌ ${rootCheck.error}`));
    return 1;
  }

  // AC-8: refuse unlinked projects before offering to start Stagepass.
  const matched = await findProjectByRoot(cwd, projectsPath);
  if (!matched) {
    error(
      chalk.red(
        'No linked Stagepass project for this directory. Run `stagepass link` first.'
      )
    );
    return 1;
  }

  await (deps.ensureStagepassReady || ensureStagepassReady)(options, {
    ...deps,
    cwd,
    projectsPath,
    start: deps.start || defaultStart,
    unlinked: 'skip',
  });

  await clearStaleDevPorts(projectsPath);

  const { domain } = matched;
  let project = await getProject(domain, projectsPath);
  if (!project) {
    error(chalk.red(`No projects.json entry for ${domain}.`));
    return 1;
  }

  const foreignPid =
    typeof project.devPid === 'number' &&
    Number.isInteger(project.devPid) &&
    project.devPid > 0 &&
    project.devPid !== process.pid
      ? project.devPid
      : null;
  if (foreignPid != null && isPidAlive(foreignPid)) {
    error(
      chalk.red(
        `Another stagepass dev is already running for ${domain} (pid ${foreignPid}). Stop it before starting a second one.`
      )
    );
    return 1;
  }

  const pkgPath = path.join(cwd, 'package.json');
  if (!(await fse.pathExists(pkgPath))) {
    error(chalk.red('No package.json found in the current directory.'));
    return 1;
  }
  let pkg;
  try {
    pkg = JSON.parse(await fse.readFile(pkgPath, 'utf8'));
  } catch {
    error(chalk.red('package.json is not valid JSON.'));
    return 1;
  }
  if (!pkg.scripts || typeof pkg.scripts.watch !== 'string') {
    error(
      chalk.red(
        'No "watch" script in package.json. Add one, or use a project from `stagepass new`.'
      )
    );
    return 1;
  }

  const outDir = await readProjectOutDir(cwd, fse);
  if (!outDir.ok) {
    error(chalk.red(`❌ ${outDir.error}`));
    return 1;
  }

  if (options.verbose) {
    log(chalk.dim(`Live reload watching ${outDir.rel}/ → https://${domain}/__stagepass/live`));
  }

  let live;
  try {
    const server = createServer({
      projectRoot: rootCheck.path,
      outDir: outDir.rel,
      log: options.verbose ? (m) => log(chalk.dim(m)) : () => {},
    });
    live = await server.listen(0);
  } catch (err) {
    error(chalk.red(err instanceof Error ? err.message : String(err)));
    return 1;
  }

  if (!isValidDevPort(live.port)) {
    await live.close().catch(() => {});
    error(chalk.red(`Event server bound an invalid port (${live.port}).`));
    return 1;
  }

  /** @type {Promise<void>|null} */
  let cleaning = null;
  // Idempotent: every caller awaits the same run, so the Caddy block is restored before exit.
  const cleanup = () => {
    if (!cleaning) cleaning = runCleanup();
    return cleaning;
  };
  const runCleanup = async () => {
    try {
      await live.close();
    } catch {
      /* ignore */
    }
    try {
      // Only clear our own port so a parallel later `dev` is not wiped (AC-7).
      const current = await getProject(domain, projectsPath);
      if (
        current &&
        (current.devPid == null || current.devPid === process.pid)
      ) {
        await setProjectDevPort(domain, { port: null }, projectsPath);
        const cleared = await getProject(domain, projectsPath);
        if (cleared) {
          await applySiteBlock(domain, cleared, { caddyfilePath, fs: fse });
          try {
            await reloadCaddy(caddyfilePath, options.verbose);
          } catch {
            /* ignore on exit */
          }
        }
      }
    } catch {
      /* ignore */
    }
  };

  /** @type {NodeJS.Signals | null} */
  let stopSignal = null;
  let setupDone = false; // eager cleanup only after setup (P-3 / AC-7)
  /** @param {NodeJS.Signals} signal */
  const onSignal = (signal) => {
    if (stopSignal) return;
    stopSignal = signal;
    if (setupDone) void cleanup();
  };
  // Register before setProjectDevPort so a signal in the setup window is seen (P-3 / AC-7).
  // Node signal listeners do not receive the name as an argument — bind it explicitly.
  const onSigInt = () => onSignal('SIGINT');
  const onSigTerm = () => onSignal('SIGTERM');
  const onSigHup = () => onSignal('SIGHUP');
  process.on('SIGINT', onSigInt);
  process.on('SIGTERM', onSigTerm);
  process.on('SIGHUP', onSigHup);
  const detachSignals = () => {
    process.off('SIGINT', onSigInt);
    process.off('SIGTERM', onSigTerm);
    process.off('SIGHUP', onSigHup);
  };

  try {
    await setProjectDevPort(domain, { port: live.port, pid: process.pid }, projectsPath);
    if (stopSignal) {
      detachSignals();
      await cleanup();
      return signalExitCode(stopSignal);
    }
    project = await getProject(domain, projectsPath);
    const applied = await applySiteBlock(domain, project, { caddyfilePath, fs: fse });
    if (!applied.ok) {
      detachSignals();
      await cleanup();
      error(chalk.red(`❌ ${applied.error}`));
      return 1;
    }
    try {
      await reloadCaddy(caddyfilePath, options.verbose);
    } catch (err) {
      log(chalk.yellow('Caddy reload failed. Is Stagepass running? Try: stagepass start'));
      if (options.verbose) error(err);
    }
  } catch (err) {
    detachSignals();
    await cleanup();
    error(chalk.red(err instanceof Error ? err.message : String(err)));
    return 1;
  }

  if (stopSignal) {
    detachSignals();
    await cleanup();
    return signalExitCode(stopSignal);
  }

  setupDone = true;

  log(chalk.green(`Live reload on https://${domain}/__stagepass/live (127.0.0.1:${live.port})`));
  if (options.verbose) {
    log(chalk.dim('Running: npm run watch'));
  }

  let watchCode = 1;
  try {
    const result = await spawnWatch('npm', ['run', 'watch'], {
      cwd,
      stdio: 'inherit',
      shell: false,
      env: process.env,
      signalGraceMs: graceMs,
    });
    watchCode = typeof result.code === 'number' ? result.code : 1;
  } catch (err) {
    error(chalk.red(err instanceof Error ? err.message : String(err)));
    watchCode = 1;
  } finally {
    detachSignals();
    await cleanup();
  }

  if (stopSignal) return signalExitCode(stopSignal);
  return watchCode;
}

/**
 * Spawn without a shell; forward SIGINT/SIGTERM/SIGHUP to the child; SIGKILL after grace.
 * @type {import('../lib/spawn.js').SpawnFn}
 */
export function defaultSpawnWatch(command, args = [], options = {}) {
  const graceMs =
    typeof options.signalGraceMs === 'number' ? options.signalGraceMs : DEV_SIGNAL_GRACE_MS;
  const { signalGraceMs: _omit, ...spawnOpts } = options;
  return new Promise((resolve, reject) => {
    const child = nodeSpawn(command, args, {
      stdio: 'inherit',
      ...spawnOpts,
      shell: false,
    });

    let exited = false;
    /** @type {ReturnType<typeof setTimeout> | undefined} */
    let killTimer;

    const forward = (signal) => {
      try {
        child.kill(signal);
      } catch {
        /* ignore */
      }
      if (killTimer) clearTimeout(killTimer);
      killTimer = setTimeout(() => {
        if (!exited) {
          try {
            child.kill('SIGKILL');
          } catch {
            /* ignore */
          }
        }
      }, graceMs);
    };
    const onSigInt = () => forward('SIGINT');
    const onSigTerm = () => forward('SIGTERM');
    const onSigHup = () => forward('SIGHUP');
    process.on('SIGINT', onSigInt);
    process.on('SIGTERM', onSigTerm);
    process.on('SIGHUP', onSigHup);

    const detach = () => {
      process.off('SIGINT', onSigInt);
      process.off('SIGTERM', onSigTerm);
      process.off('SIGHUP', onSigHup);
      if (killTimer) clearTimeout(killTimer);
    };

    child.on('error', (err) => {
      exited = true;
      detach();
      reject(err);
    });
    child.on('close', (code, signal) => {
      exited = true;
      detach();
      resolve({ code, signal });
    });
  });
}
