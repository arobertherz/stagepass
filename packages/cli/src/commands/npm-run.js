import fs from 'fs-extra';
import path from 'path';
import chalk from 'chalk';
import { defaultSpawn } from '../lib/spawn.js';
import { ensureStagepassReady } from '../lib/ensure-running.js';
import { warnPhpProject } from '../lib/php-runtime.js';
import { ensurePhpFpm } from '../lib/php-fpm.js';
import { start as defaultStart } from './start.js';

/**
 * Run an npm lifecycle script in cwd via spawn (no shell).
 *
 * @param {string} scriptName
 * @param {object} [options]
 * @param {boolean} [options.verbose]
 * @param {object} [deps]
 * @param {typeof fs} [deps.fs]
 * @param {string} [deps.cwd]
 * @param {import('../lib/spawn.js').SpawnFn} [deps.spawn]
 * @param {(msg?: string) => void} [deps.log]
 * @param {(msg?: string) => void} [deps.error]
 * @returns {Promise<number>} exit code
 */
export async function runNpmScript(scriptName, options = {}, deps = {}) {
  const fse = deps.fs || fs;
  const cwd = deps.cwd || process.cwd();
  const spawn = deps.spawn || defaultSpawn;
  const log = deps.log || console.log;
  const error = deps.error || console.error;
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

  if (!pkg.scripts || typeof pkg.scripts[scriptName] !== 'string') {
    error(
      chalk.red(
        `No "${scriptName}" script in package.json. Add one, or run this command inside a Stagepass project created with \`stagepass new\`.`
      )
    );
    return 1;
  }

  if (options.verbose) {
    log(chalk.dim(`Running: npm run ${scriptName}`));
  }

  try {
    const result = await spawn('npm', ['run', scriptName], {
      cwd,
      stdio: 'inherit',
      shell: false,
      env: process.env,
    });
    return typeof result.code === 'number' ? result.code : 1;
  } catch (err) {
    error(chalk.red(err instanceof Error ? err.message : String(err)));
    return 1;
  }
}

/**
 * @param {object} [options]
 * @param {boolean} [options.verbose]
 * @param {boolean} [options.yes]
 * @param {object} [deps]
 * @returns {Promise<number>}
 */
export async function watch(options = {}, deps = {}) {
  const cwd = deps.cwd || process.cwd();
  await warnPhpProject(cwd, {
    fs: deps.fs,
    exec: deps.exec,
    platform: deps.platform,
    pathExists: deps.pathExists,
    resolveCommand: deps.resolveCommand,
    brewPrefix: deps.brewPrefix,
    domain: deps.domain,
    warn: (m) => (deps.log || console.log)(chalk.yellow(m)),
    ensurePhpFpm: deps.ensurePhpFpm || ensurePhpFpm,
  });
  await (deps.ensureStagepassReady || ensureStagepassReady)(options, {
    ...deps,
    start: deps.start || defaultStart,
  });
  return runNpmScript('watch', options, deps);
}

/**
 * @param {object} [options]
 * @param {object} [deps]
 * @returns {Promise<number>}
 */
export async function build(options = {}, deps = {}) {
  return runNpmScript('build', options, deps);
}
