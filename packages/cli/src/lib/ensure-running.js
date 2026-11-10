import chalk from 'chalk';
import { defaultExec } from './exec.js';
import { parseLsofListenOutput } from './doctor.js';
import { findProjectByRoot } from './projects.js';
import { getProjectsPath } from './paths.js';
import { confirm as defaultConfirm } from './prompts.js';

/** Caddy listening on TCP 443 (same lsof parse as doctor); null if unknown. */
export async function isStagepassRunning(opts = {}) {
  const exec = opts.exec || defaultExec;
  try {
    const { stdout } = await exec('lsof', ['-nP', '-iTCP:443', '-sTCP:LISTEN']);
    return parseLsofListenOutput(stdout).some(
      (l) => /caddy/i.test(l.command) || /caddy/i.test(l.name)
    );
  } catch (error) {
    const err = /** @type {{ code?: string|number }} */ (error);
    return err.code === 1 || err.code === '1' ? false : null;
  }
}

/**
 * Before watch/dev: offer start when down; warn when cwd is unlinked unless `unlinked: 'skip'`.
 * @returns {Promise<{ running: boolean|null, linked: boolean, started: boolean }>}
 */
export async function ensureStagepassReady(options = {}, deps = {}) {
  const log = deps.log || console.log;
  const warn = (msg) => log(chalk.yellow(msg));
  const cwd = deps.cwd || process.cwd();
  const projectsPath = deps.projectsPath || getProjectsPath();
  const isRunningFn = deps.isStagepassRunning || isStagepassRunning;
  const findLinked = deps.findProjectByRoot || findProjectByRoot;
  const confirm = deps.confirm || defaultConfirm;
  const interactive =
    options.yes !== true &&
    !(deps.ci ?? process.env.CI) &&
    Boolean(
      (deps.stdin || process.stdin).isTTY && (deps.stdout || process.stdout).isTTY
    );

  let running = await isRunningFn({ exec: deps.exec });
  let started = false;

  if (running === false) {
    const shouldStart =
      options.yes === true ||
      (interactive &&
        (await confirm('Stagepass is not running. Start it now?', {
          default: true,
        })));

    if (shouldStart && typeof deps.start === 'function') {
      try {
        const code = await deps.start({
          verbose: options.verbose,
          interactive: options.yes !== true && interactive,
          exec: deps.exec,
          confirm,
        });
        // start() must return 0 on success; undefined/non-zero means not started.
        if (typeof code !== 'number' || code !== 0) {
          warn('Could not start Stagepass. Run: stagepass start');
          running = await isRunningFn({ exec: deps.exec });
        } else {
          running = await isRunningFn({ exec: deps.exec });
          if (running === true) {
            started = true;
          } else {
            warn('Could not start Stagepass. Run: stagepass start');
          }
        }
      } catch {
        warn('Could not start Stagepass. Run: stagepass start');
      }
    } else if (!shouldStart) {
      warn('Stagepass is not running. Start it with: stagepass start');
    }
  }

  let linked = true;
  if (deps.unlinked !== 'skip') {
    linked = Boolean(await findLinked(cwd, projectsPath));
    if (!linked) {
      warn('This directory is not linked to a .sp domain. Run: stagepass link');
    }
  }

  return { running, linked, started };
}
