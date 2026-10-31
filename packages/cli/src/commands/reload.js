import chalk from 'chalk';
import { execa } from 'execa';
import ora from 'ora';
import fs from 'fs-extra';
import { getCaddyfilePath, getProjectsPath } from '../lib/paths.js';
import {
  ensureCaddyfileMigrated,
  warnIfAllowAllOriginsActive,
} from '../lib/migrate.js';

export async function reload(options = {}) {
  const caddyFilePath = getCaddyfilePath();
  const projectsPath = getProjectsPath();

  const spinner = ora('Reloading Caddy...').start();

  if (!(await fs.pathExists(caddyFilePath))) {
    spinner.fail('No Caddyfile found. Run "stagepass link" first.');
    return;
  }

  try {
    await execa('caddy', ['version'], { stdio: 'ignore' });
  } catch {
    spinner.fail('Caddy is not installed or not accessible.');
    console.log(chalk.dim('   Run "stagepass setup" to install dependencies.'));
    return;
  }

  try {
    spinner.stop();
    await ensureCaddyfileMigrated({ caddyfilePath: caddyFilePath, projectsPath });
    await warnIfAllowAllOriginsActive({ caddyfilePath: caddyFilePath });
    spinner.start('Reloading Caddy...');

    const stdioMode = options.verbose ? 'inherit' : 'ignore';
    await execa('caddy', ['reload', '--config', caddyFilePath], { stdio: stdioMode });
    spinner.succeed('Caddy reloaded successfully.');
  } catch (error) {
    spinner.fail('Failed to reload Caddy.');
    console.log(chalk.dim('   Is Stagepass running? Try: stagepass start'));
    if (options.verbose) console.error(error);
  }
}
