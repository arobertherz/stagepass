import { execa } from 'execa';
import chalk from 'chalk';
import ora from 'ora';

export async function stop(options = {}) {
  console.log(chalk.bold('\n🛑 Stopping Stagepass...'));
  
  const spinner = ora('Shutting down services...').start();
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
      // Ignorieren, wenn schon gestoppt
    }

    // 2. Stop PHP (Optional, aber sauberer)
    try {
      await execa('brew', ['services', 'stop', 'php'], { stdio: stdioMode });
    } catch (e) {
        // Ignorieren
    }

    if (!options.verbose) {
        spinner.succeed(chalk.green('Services stopped.'));
    } else {
        console.log(chalk.green('✔ Services stopped.'));
    }

  } catch (error) {
    if (!options.verbose) spinner.fail('Error stopping services.');
    console.error(chalk.red(error.message));
  }
}