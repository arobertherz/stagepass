import chalk from 'chalk';
import ora from 'ora';
import os from 'node:os';
import { defaultExec } from '../lib/exec.js';
import {
  getAutostartStatus,
  buildLaunchctlBootoutArgs,
  LAUNCH_AGENT_LABEL,
} from '../lib/autostart.js';

export async function stop(options = {}) {
  console.log(chalk.bold('\n🛑 Stopping Stagepass...'));

  const exec = options.exec || defaultExec;
  const spinner = ora('Shutting down services...').start();
  const stdioMode = options.verbose ? 'inherit' : 'ignore';

  if (options.verbose) {
    spinner.stop();
    console.log(chalk.dim('--- Verbose Logs ---'));
  }

  try {
    /** @type {{ loaded?: boolean, plistExists?: boolean, plistPath?: string }} */
    let status = { loaded: false, plistExists: false };
    try {
      status =
        (await (options.getAutostartStatus || getAutostartStatus)({ exec })) ||
        status;
    } catch {
      // ignore status failures; still stop caddy/php
    }
    const uid = options.uid ?? process.getuid?.() ?? os.userInfo().uid;
    let usedBootout = false;

    if (status.loaded || status.plistExists) {
      try {
        await exec('launchctl', buildLaunchctlBootoutArgs(uid));
        usedBootout = true;
      } catch {
        // not loaded
      }
    }

    // Always attempt a direct caddy stop as well (covers non-autostart / leftover).
    try {
      await exec('caddy', ['stop'], { stdio: stdioMode });
    } catch {
      // Ignore if already stopped
    }

    try {
      await exec('brew', ['services', 'stop', 'php'], { stdio: stdioMode });
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
    console.error(chalk.red(error instanceof Error ? error.message : String(error)));
  }
}
