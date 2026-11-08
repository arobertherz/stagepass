import { execa } from 'execa';
import chalk from 'chalk';
import { createSpinner } from '../lib/spinner.js';
import { getAutostartStatus } from '../lib/autostart.js';

export async function stop(options = {}) {
  console.log(chalk.bold('\n🛑 Stopping Stagepass...'));
  
  const spinner = createSpinner('Shutting down services...').start();
  const stdioMode = options.verbose ? 'inherit' : 'ignore';

  if (options.verbose) {
      spinner.stop();
      console.log(chalk.dim('--- Verbose Logs ---'));
  }

  try {
    // 1. Stop Caddy
    try {
      await execa('caddy', ['stop'], { stdio: stdioMode });
    } catch (e) {
      // Ignore if already stopped
    }

    // 2. Stop PHP (optional, but cleaner)
    try {
      await execa('brew', ['services', 'stop', 'php'], { stdio: stdioMode });
    } catch (e) {
        // Ignore
    }

    if (!options.verbose) {
        spinner.succeed(chalk.green('Services stopped.'));
    } else {
        console.log(chalk.green('✔ Services stopped.'));
    }

    // Non-breaking hint only: existing stop semantics stay unchanged.
    try {
      const status = await getAutostartStatus();
      if (status.loaded || status.plistExists) {
        console.log(
          chalk.dim(
            'Autostart is enabled; Caddy may start again at next login. Use `stagepass autostart off` to disable permanently.'
          )
        );
      }
    } catch {
      // ignore status failures
    }

  } catch (error) {
    if (!options.verbose) spinner.fail('Error stopping services.');
    console.error(chalk.red(error.message));
  }
}