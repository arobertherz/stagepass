import chalk from 'chalk';
import { defaultExec } from './exec.js';
import { parseLsofListenOutput } from './doctor.js';
import { findProjectByRoot } from './projects.js';
import { getProjectsPath } from './paths.js';
import { confirm as defaultConfirm } from './prompts.js';

/**
 * Whether Caddy (Stagepass) is listening on TCP 443.
 * Same local lsof check as doctor / start (no network, no sudo).
 *
 * @param {object} [opts]
 * @param {import('./exec.js').ExecFn} [opts.exec]
 * @returns {Promise<boolean|null>} true/false when known; null if inspection failed
 */
export async function isStagepassRunning(opts = {}) {
  const exec = opts.exec || defaultExec;
  try {
    const { stdout } = await exec('lsof', [
      '-nP',
      '-iTCP:443',
      '-sTCP:LISTEN',
    ]);
    const listeners = parseLsofListenOutput(stdout);
    return listeners.some(
      (l) => /caddy/i.test(l.command) || /caddy/i.test(l.name)
    );
  } catch (error) {
    const err = /** @type {{ code?: string|number }} */ (error);
    // lsof exits 1 when nothing is listening
    if (err.code === 1 || err.code === '1') return false;
    return null;
  }
}

/**
 * Interactive only when both stdin and stdout are TTYs, not CI, and not --yes.
 *
 * @param {object} [options]
 * @param {boolean} [options.yes]
 * @param {object} [deps]
 * @param {NodeJS.ReadStream} [deps.stdin]
 * @param {NodeJS.WriteStream} [deps.stdout]
 * @param {boolean} [deps.ci]
 */
export function isInteractiveSession(options = {}, deps = {}) {
  if (options.yes === true) return false;
  const ci = deps.ci != null ? Boolean(deps.ci) : Boolean(process.env.CI);
  if (ci) return false;
  const stdin = deps.stdin || process.stdin;
  const stdout = deps.stdout || process.stdout;
  return Boolean(stdin.isTTY && stdout.isTTY);
}

/**
 * Before watch/dev: offer to start Stagepass when down; hint when cwd is unlinked.
 *
 * @param {object} [options]
 * @param {boolean} [options.verbose]
 * @param {boolean} [options.yes] Auto-start when not running (no prompt)
 * @param {object} [deps]
 * @param {'warn'|'error'|'skip'} [deps.unlinked] Default `warn`
 * @param {(opts?: object) => Promise<unknown>} [deps.start] Required to start in-process
 * @returns {Promise<{ ok: boolean, running: boolean|null, linked: boolean, started: boolean, code?: number }>}
 */
export async function ensureStagepassReady(options = {}, deps = {}) {
  const log = deps.log || console.log;
  const error = deps.error || console.error;
  const cwd = deps.cwd || process.cwd();
  const projectsPath = deps.projectsPath || getProjectsPath();
  const isRunningFn = deps.isStagepassRunning || isStagepassRunning;
  const findLinked = deps.findProjectByRoot || findProjectByRoot;
  const confirm = deps.confirm || defaultConfirm;
  const interactive = isInteractiveSession(options, deps);

  let running = await isRunningFn({ exec: deps.exec });
  let started = false;

  if (running === false) {
    const shouldStart =
      options.yes === true ||
      (interactive &&
        (await confirm('Stagepass is not running. Start it now?', {
          default: true,
        })));

    if (shouldStart) {
      const startFn = deps.start;
      if (typeof startFn === 'function') {
        await startFn({
          verbose: options.verbose,
          // Nested prompts only when the user already answered interactively
          interactive: options.yes !== true && interactive,
          exec: deps.exec,
          confirm,
        });
        started = true;
        running = true;
      }
    } else {
      log(
        chalk.yellow(
          'Stagepass is not running. Start it with: stagepass start'
        )
      );
    }
  }

  const unlinkedMode = deps.unlinked || 'warn';
  let linked = true;
  if (unlinkedMode !== 'skip') {
    const matched = await findLinked(cwd, projectsPath);
    linked = Boolean(matched);
    if (!linked) {
      if (unlinkedMode === 'error') {
        error(
          chalk.red(
            'No linked Stagepass project for this directory. Run `stagepass link` first.'
          )
        );
        return { ok: false, running, linked, started, code: 1 };
      }
      log(
        chalk.yellow(
          'This directory is not linked to a .sp domain. Run: stagepass link'
        )
      );
    }
  }

  return { ok: true, running, linked, started };
}
