import path from 'path';
import os from 'os';
import chalk from 'chalk';
import { execa } from 'execa';
import ora from 'ora';
import fs from 'fs-extra';

export async function reload(options = {}) {
  const caddyDir = path.join(os.homedir(), '.stagepass');
  const caddyFilePath = path.join(caddyDir, 'Caddyfile');

  const spinner = ora('Reloading Caddy...').start();

  // Check if Caddyfile exists
  if (!await fs.pathExists(caddyFilePath)) {
    spinner.fail('No Caddyfile found. Run "stagepass link" first.');
    return;
  }

  // Check if Caddy is running
  try {
    await execa('caddy', ['version'], { stdio: 'ignore' });
  } catch (e) {
    spinner.fail('Caddy is not installed or not accessible.');
    console.log(chalk.dim('   Run "stagepass setup" to install dependencies.'));
    return;
  }

  // Reload Caddy
  try {
    const stdioMode = options.verbose ? 'inherit' : 'ignore';
    
    await execa('caddy', ['reload', '--config', caddyFilePath], { stdio: stdioMode });
    
    spinner.succeed('Caddy reloaded successfully.');
  } catch (error) {
    spinner.fail('Failed to reload Caddy.');
    console.log(chalk.dim('   Is Stagepass running? Try: stagepass start'));
    if (options.verbose) console.error(error);
  }
}
