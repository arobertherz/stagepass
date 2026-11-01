import fs from 'fs-extra';
import path from 'path';
import chalk from 'chalk';
import { execa } from 'execa';
import ora from 'ora';
import { resolveLinkDomain } from '../lib/domain.js';
import { removeBlock } from '../lib/caddyfile.js';
import { getCaddyfilePath, getProjectsPath } from '../lib/paths.js';
import { removeProject } from '../lib/projects.js';

export async function unlink(domain, options = {}) {
  const currentDir = process.cwd();
  const folderName = path.basename(currentDir);

  const resolved = resolveLinkDomain(domain, folderName);
  if (!resolved.ok) {
    console.log(chalk.red(`❌ ${resolved.error}`));
    return;
  }

  const targetDomain = resolved.domain;
  const caddyFilePath = getCaddyfilePath();
  const projectsPath = getProjectsPath();

  const spinner = ora(`Unlinking ${chalk.bold(targetDomain)}...`).start();

  try {
    if (!(await fs.pathExists(caddyFilePath))) {
      spinner.warn('No Caddyfile found. Nothing to unlink.');
      return;
    }

    let content = await fs.readFile(caddyFilePath, 'utf-8');
    const result = removeBlock(content, targetDomain);

    if (!result.removed) {
      spinner.warn(`Domain ${chalk.bold(targetDomain)} is not linked.`);
      return;
    }

    await fs.writeFile(caddyFilePath, result.content ? `${result.content}\n` : '', 'utf-8');
    await removeProject(targetDomain, projectsPath);
  } catch (e) {
    spinner.fail('Failed to update config.');
    if (options.verbose) console.error(e);
    return;
  }

  try {
    const stdioMode = options.verbose ? 'inherit' : 'ignore';
    await execa('caddy', ['reload', '--config', caddyFilePath], { stdio: stdioMode });
    spinner.succeed(`Unlinked: ${targetDomain}`);
  } catch (error) {
    spinner.warn('Config updated, but Caddy reload failed.');
    console.log(chalk.dim('   Is Stagepass running? Try: stagepass start'));
    if (options.verbose) console.error(error);
  }
}
