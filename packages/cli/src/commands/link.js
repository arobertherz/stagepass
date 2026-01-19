import fs from 'fs-extra';
import path from 'path';
import os from 'os';
import chalk from 'chalk';
import { execa } from 'execa';
import ora from 'ora';

export async function link(domain, options = {}) {
  const currentDir = process.cwd();

  // Domain logic
  let targetDomain = domain;
  if (!targetDomain) {
    targetDomain = path.basename(currentDir);
  }
  targetDomain = targetDomain.replace(/\.sp$/, '') + '.sp';

  // Config paths
  const caddyDir = path.join(os.homedir(), '.stagepass');
  const caddyFilePath = path.join(caddyDir, 'Caddyfile');

  const spinner = ora(`Linking ${chalk.bold(targetDomain)}...`).start();

  // 1. Write config
  try {
      await fs.ensureDir(caddyDir);
      
      let content = '';
      if (await fs.pathExists(caddyFilePath)) {
        content = await fs.readFile(caddyFilePath, 'utf-8');
      }

      const blockStart = `# START: ${targetDomain}`;
      const blockEnd = `# END: ${targetDomain}`;

      const newBlock = `
${blockStart}
${targetDomain} {
    root * "${currentDir}"
    php_fastcgi 127.0.0.1:9000
    file_server
    tls internal
    header Access-Control-Allow-Origin *
}
${blockEnd}`;

      const regex = new RegExp(`${escapeRegExp(blockStart)}[\\s\\S]*?${escapeRegExp(blockEnd)}`, 'g');

      if (regex.test(content)) {
        content = content.replace(regex, newBlock.trim());
      } else {
        content += `\n${newBlock.trim()}\n`;
      }

      await fs.writeFile(caddyFilePath, content.trim());
  } catch (e) {
      spinner.fail('Failed to write config.');
      if (options.verbose) console.error(e);
      return;
  }

  // 2. Reload Caddy
  try {
    // If verbose is ON, show output. If OFF, ignore it (pipe).
    const stdioMode = options.verbose ? 'inherit' : 'ignore';
    
    await execa('caddy', ['reload', '--config', caddyFilePath], { stdio: stdioMode });
    
    spinner.succeed(`Linked: https://${targetDomain} -> ${currentDir}`);
  } catch (error) {
    spinner.warn('Config written, but Caddy reload failed.');
    console.log(chalk.dim('   Is Stagepass running? Try: stagepass start'));
    if (options.verbose) console.error(error);
  }
}

function escapeRegExp(string) {
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}