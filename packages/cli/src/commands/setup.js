import { execa } from 'execa';
import ora from 'ora';
import chalk from 'chalk';
import fs from 'fs-extra';
import path from 'path';
import sudo from 'sudo-prompt';

const sudoExec = (command) => {
  return new Promise((resolve, reject) => {
    sudo.exec(command, { name: 'Stagepass Setup' }, (error, stdout, stderr) => {
      if (error) reject(error);
      else resolve(stdout);
    });
  });
};

export async function setup(options = {}) {
  console.log(chalk.bold('\n🛠  Initializing Stagepass Environment...'));
  
  const execOpts = options.verbose ? { stdio: 'inherit' } : {};

  // 1. Check Homebrew
  const brewSpinner = ora('Checking system requirements...').start();
  try {
    await execa('brew', ['--version']);
    brewSpinner.succeed('System requirements met.');
  } catch (e) {
    brewSpinner.fail('Homebrew is missing.');
    return;
  }

  // 2. Install Dependencies
  const installSpinner = ora('Installing dependencies...').start();
  try {
    await execa('brew', ['install', 'caddy', 'php', 'dnsmasq'], execOpts);
    installSpinner.succeed('Core dependencies installed.');
  } catch (e) {
    installSpinner.fail('Installation failed.');
    throw e;
  }
  
  // 3. Configure Dnsmasq (DIRECT WRITE STRATEGY)
  const dnsSpinner = ora('Configuring local DNS (.sp)...').start();
  try {
    const { stdout: brewPrefixRaw } = await execa('brew', ['--prefix']);
    const brewPrefix = brewPrefixRaw.trim();
    const mainConfFile = path.join(brewPrefix, 'etc', 'dnsmasq.conf');

    // Sicherstellen, dass Config existiert
    if (!await fs.pathExists(mainConfFile)) {
        await fs.writeFile(mainConfFile, '# Stagepass Config\n');
    }

    let content = await fs.readFile(mainConfFile, 'utf-8');
    const rule = 'address=/.sp/127.0.0.1';

    // Prüfen, ob Regel schon da ist
    if (!content.includes(rule)) {
        await fs.appendFile(mainConfFile, `\n\n# Stagepass Rule\n${rule}\n`);
    }

    dnsSpinner.succeed('Local DNS configured.');
  } catch (e) {
    dnsSpinner.fail('DNS config failed.');
    if (options.verbose) console.error(e);
    throw e;
  }

  // 4. Configure System Resolver (Root)
  const resolverFile = '/etc/resolver/sp';
  if (!fs.existsSync(resolverFile)) {
    console.log(chalk.yellow('   sudo access required for system resolver...'));
    try {
      const cmd = `mkdir -p /etc/resolver && echo "nameserver 127.0.0.1" > ${resolverFile}`;
      await sudoExec(cmd);
      console.log(chalk.green('   ✔ Root permissions granted.'));
    } catch (e) {
      console.log(chalk.red('   ❌ Permission denied.'));
      return;
    }
  }

  // 5. Restart DNS Services
  const restartSpinner = ora('Restarting DNS services...').start();
  try {
      // Dnsmasq Restart
      try {
        await execa('sudo', ['brew', 'services', 'restart', 'dnsmasq'], execOpts);
      } catch (e) {
        await execa('brew', ['services', 'restart', 'dnsmasq'], execOpts);
      }
      
      // DNS Cache Flush
      try { await execa('sudo', ['killall', '-HUP', 'mDNSResponder']); } catch(e) {}
      
      restartSpinner.succeed('DNS services active.');
  } catch(e) {
      restartSpinner.warn('Could not restart Dnsmasq automatically.');
  }

  // 6. Init Caddyfile
  const caddyDir = path.join(os.homedir(), '.stagepass');
  await fs.ensureDir(caddyDir);
  const caddyFile = path.join(caddyDir, 'Caddyfile');
  if (!await fs.pathExists(caddyFile)) {
      await fs.writeFile(caddyFile, '# Stagepass Global Config\n');
  }

  console.log(chalk.green('\n✅ Setup complete!'));
}