import chalk from 'chalk';
import {
  enableAutostart,
  disableAutostart,
  getAutostartStatus,
  LAUNCH_AGENT_LABEL,
} from '../lib/autostart.js';

/**
 * @param {'on'|'off'|'status'} action
 * @param {object} [options]
 * @param {boolean} [options.verbose]
 * @param {boolean} [options.json]
 * @returns {Promise<number>}
 */
export async function autostart(action, options = {}) {
  if (action === 'status') {
    const status = await getAutostartStatus();
    if (options.json) {
      console.log(
        JSON.stringify(
          {
            label: status.label,
            plistPath: status.plistPath,
            plistExists: status.plistExists,
            loaded: status.loaded,
            logsDir: status.logsDir,
          },
          null,
          2
        )
      );
    } else {
      console.log(chalk.bold('\nStagepass autostart status\n'));
      console.log(`Label:  ${status.label}`);
      console.log(`Plist:  ${status.plistPath}`);
      console.log(`Exists: ${status.plistExists ? 'yes' : 'no'}`);
      console.log(`Loaded: ${status.loaded ? 'yes' : 'no'}`);
      console.log(`Logs:   ${status.logsDir}`);
      if (!status.loaded && status.printError && options.verbose) {
        console.log(chalk.dim(`launchctl: ${status.printError}`));
      }
      console.log(
        chalk.dim(
          '\nNote: the LaunchAgent runs as your user (same as `caddy start` in stagepass start).'
        )
      );
      console.log(
        chalk.dim(
          'If port 443 bind fails, daemon exits with an error instead of silent no-op. Use stagepass start for interactive recovery.'
        )
      );
    }
    return 0;
  }

  if (action === 'on') {
    console.log(chalk.bold('\nEnabling Stagepass autostart...'));
    const result = await enableAutostart();
    if (!result.ok) {
      console.log(chalk.red(`Failed: ${result.error}`));
      return 1;
    }
    console.log(chalk.green(`LaunchAgent installed: ${result.plistPath}`));
    console.log(chalk.dim(`Label: ${LAUNCH_AGENT_LABEL}`));
    console.log(chalk.dim(`Node:  ${result.paths.nodePath}`));
    console.log(chalk.dim(`CLI:   ${result.paths.cliPath}`));
    console.log(
      chalk.dim(
        'Runs `stagepass daemon` at login (caddy run in the foreground). Never uses sudo.'
      )
    );
    return 0;
  }

  if (action === 'off') {
    console.log(chalk.bold('\nDisabling Stagepass autostart...'));
    const result = await disableAutostart();
    console.log(chalk.green(`LaunchAgent removed: ${result.plistPath}`));
    return 0;
  }

  console.log(chalk.red(`Unknown autostart action: ${action}`));
  return 1;
}
