import { execa } from 'execa';
import chalk from 'chalk';
import path from 'path';
import os from 'os';
import fs from 'fs-extra';
import inquirer from 'inquirer';
import ora from 'ora';

// --- HELPERS ---

async function checkPort443() {
  try {
    const cmd = "sudo lsof -iTCP:443 -n -P | grep LISTEN | awk '{print $2}'";
    const { stdout: rawOutput } = await execa(cmd, { shell: true });
    
    if (!rawOutput || !rawOutput.trim()) return null;

    const pids = rawOutput.trim().split('\n');
    const pid = pids[0].trim();
    if (!pid) return null;
    
    const { stdout: commandPath } = await execa('ps', ['-p', pid, '-o', 'comm=']);
    const name = path.basename(commandPath.trim());

    const ignoreList = ['Google Chrome', 'Chrome Helper', 'OneDrive', 'Music', 'Safari', 'caddy'];
    if (ignoreList.some(ignore => name.includes(ignore))) {
        return null; 
    }

    return { pid, name };
  } catch (e) {
    return null; 
  }
}

async function killProcess(proc) {
  try {
    if (proc.name.includes('nginx')) {
        try { await execa('valet', ['stop']); return true; } catch (e) {}
        try { await execa('brew', ['services', 'stop', 'nginx']); return true; } catch (e) {}
    }
    if (proc.name.includes('httpd')) {
        await execa('sudo', ['apachectl', 'stop']);
        return true;
    }
    await execa('sudo', ['kill', '-9', proc.pid]);
    return true;
  } catch (error) {
    return false;
  }
}

// --- MAIN COMMAND ---

export async function start(options = {}) {
  const caddyDir = path.join(os.homedir(), '.stagepass');
  const caddyFile = path.join(caddyDir, 'Caddyfile');
  const logFile = path.join(caddyDir, 'server.log');

  console.log(chalk.bold('\n🚀 Starting Stagepass...'));

  // 1. Sudo warm-up (interactive, before spinner starts)
  try {
    await execa('sudo', ['-v'], { stdio: 'inherit' });
  } catch (e) {
    console.log(chalk.red('❌ Root permissions required.'));
    return;
  }

  // 2. Port check (interactive)
  const conflict = await checkPort443();
  if (conflict) {
    console.log(chalk.yellow(`\n⚠️  Port 443 is blocked by: ${chalk.bold(conflict.name)}`));
    const { shouldKill } = await inquirer.prompt([{
      type: 'confirm',
      name: 'shouldKill',
      message: 'Auto-fix conflict?',
      default: true
    }]);

    if (shouldKill) {
      const killSpinner = ora('Freeing port...').start();
      const success = await killProcess(conflict);
      if (success) killSpinner.succeed('Port freed.');
      else {
        killSpinner.fail('Could not free port.');
        return;
      }
    } else {
      return;
    }
  }

  // 3. Boot services
  const spinner = ora('Booting background services...').start();
  
  // Prepare logging (standard mode)
  let stdioMode = 'ignore';
  if (options.verbose) {
    spinner.stop();
    console.log(chalk.dim('--- Verbose Logs ---'));
    stdioMode = 'inherit';
  } else {
    // Redirect stdout/stderr to logfile
    const logStream = fs.openSync(logFile, 'w');
    stdioMode = ['ignore', logStream, logStream];
  }

  try {
    // Start PHP
    try {
        await execa('brew', ['services', 'restart', 'php'], { stdio: stdioMode === 'inherit' ? 'inherit' : 'ignore' });
    } catch (e) { /* ignore php errors */ }

    // Start Caddy
    // Stop old first
    try { await execa('caddy', ['stop']); } catch (e) {}

    await execa('caddy', ['start', '--config', caddyFile], { stdio: stdioMode });

    if (!options.verbose) {
        spinner.succeed(chalk.green('Stagepass is active.'));
        console.log(chalk.dim(`   Logs: ${logFile}`));
    }

  } catch (error) {
    spinner.fail('Failed to start.');
    if (!options.verbose) {
        console.log(chalk.red('See error log for details:'));
        console.log(chalk.dim(logFile));
    }
  }
}