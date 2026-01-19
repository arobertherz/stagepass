import fs from 'fs-extra';
import path from 'path';
import os from 'os';
import chalk from 'chalk';
import { execa } from 'execa';
import ora from 'ora';

function escapeRegExp(string) {
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export async function unlink(domain, options = {}) {
  const currentDir = process.cwd();

  // Domain Logic
  let targetDomain = domain;
  if (!targetDomain) {
    targetDomain = path.basename(currentDir);
  }
  targetDomain = targetDomain.replace(/\.sp$/, '') + '.sp';

  // Config Paths
  const caddyDir = path.join(os.homedir(), '.stagepass');
  const caddyFilePath = path.join(caddyDir, 'Caddyfile');

  const spinner = ora(`Unlinking ${chalk.bold(targetDomain)}...`).start();

  // 1. Read Config
  try {
    if (!await fs.pathExists(caddyFilePath)) {
      spinner.warn('No Caddyfile found. Nothing to unlink.');
      return;
    }

    let content = await fs.readFile(caddyFilePath, 'utf-8');

    const blockStart = `# START: ${targetDomain}`;
    const blockEnd = `# END: ${targetDomain}`;
    const regex = new RegExp(`${escapeRegExp(blockStart)}[\\s\\S]*?${escapeRegExp(blockEnd)}`, 'g');

    if (!regex.test(content)) {
      spinner.warn(`Domain ${chalk.bold(targetDomain)} is not linked.`);
      return;
    }

    // Remove the block
    content = content.replace(regex, '').trim();
    
    // Clean up multiple empty lines
    content = content.replace(/\n{3,}/g, '\n\n');

    await fs.writeFile(caddyFilePath, content);
  } catch (e) {
    spinner.fail('Failed to update config.');
    if (options.verbose) console.error(e);
    return;
  }

  // 2. Reload Caddy
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
