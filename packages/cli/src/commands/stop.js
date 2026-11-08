import { execa as defaultExeca } from 'execa';
import chalk from 'chalk';
import os from 'node:os';
import { createSpinner } from '../lib/spinner.js';
import {
  getAutostartStatus,
  buildLaunchctlBootoutArgs,
  LAUNCH_AGENT_LABEL,
} from '../lib/autostart.js';

/**
 * @param {object} [options]
 * @param {boolean} [options.verbose]
 * @param {typeof defaultExeca} [options.execa]
 * @param {typeof getAutostartStatus} [options.getAutostartStatus]
 * @param {number} [options.uid]
 */
export async function stop(options = {}) {
  const run = options.execa || defaultExeca;
  console.log(chalk.bold('\n🛑 Stopping Stagepass...'));

  const spinner = createSpinner('Shutting down services...').start();
  const stdioMode = options.verbose ? 'inherit' : 'ignore';

  if (options.verbose) {
    spinner.stop();
    console.log(chalk.dim('--- Verbose Logs ---'));
  }

  try {
    /** @type {{ loaded?: boolean, plistExists?: boolean }} */
    let status = { loaded: false, plistExists: false };
    try {
      status =
        (await (options.getAutostartStatus || getAutostartStatus)({})) ||
        status;
    } catch {
      // ignore status failures; still stop caddy/php
    }
    const uid = options.uid ?? process.getuid?.() ?? os.userInfo().uid;
    let usedBootout = false;

    // Bootout first so KeepAlive/RunAtLoad cannot immediately restart during stop.
    if (status.loaded || status.plistExists) {
      try {
        await run('launchctl', buildLaunchctlBootoutArgs(uid));
        usedBootout = true;
      } catch {
        // not loaded
      }
    }

    try {
      await run('caddy', ['stop'], { stdio: stdioMode });
    } catch {
      // Ignore if already stopped
    }

    try {
      await run('brew', ['services', 'stop', 'php'], { stdio: stdioMode });
    } catch {
      // Ignore
    }

    if (!options.verbose) {
      spinner.succeed(chalk.green('Services stopped.'));
    } else {
      console.log(chalk.green('✔ Services stopped.'));
    }

    if (usedBootout || status.loaded || status.plistExists) {
      console.log(
        chalk.dim(
          `Autostart LaunchAgent ${LAUNCH_AGENT_LABEL} was stopped with launchctl bootout (until next login). Use \`stagepass autostart off\` to disable permanently.`
        )
      );
    }
  } catch (error) {
    if (!options.verbose) spinner.fail('Error stopping services.');
    console.error(
      chalk.red(error instanceof Error ? error.message : String(error))
    );
  }
}
