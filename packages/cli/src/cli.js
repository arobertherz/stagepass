import { createRequire } from 'module';
import { Command } from 'commander';
import chalk from 'chalk';
import { setup as defaultSetup } from './commands/setup.js';
import { link as defaultLink } from './commands/link.js';
import { unlink as defaultUnlink } from './commands/unlink.js';
import { start as defaultStart } from './commands/start.js';
import { stop as defaultStop } from './commands/stop.js';
import { reload as defaultReload } from './commands/reload.js';

const require = createRequire(import.meta.url);
const { version: packageVersion } = require('../package.json');

function collectRepeatable(value, previous) {
  return previous.concat([value]);
}

/**
 * Build the Commander program (no parse). Injectable handlers for unit tests.
 *
 * @param {object} [deps]
 * @param {typeof defaultSetup} [deps.setup]
 * @param {typeof defaultLink} [deps.link]
 * @param {typeof defaultUnlink} [deps.unlink]
 * @param {typeof defaultStart} [deps.start]
 * @param {typeof defaultStop} [deps.stop]
 * @param {typeof defaultReload} [deps.reload]
 * @param {string} [deps.version]
 */
export function createProgram(deps = {}) {
  const setup = deps.setup || defaultSetup;
  const link = deps.link || defaultLink;
  const unlink = deps.unlink || defaultUnlink;
  const start = deps.start || defaultStart;
  const stop = deps.stop || defaultStop;
  const reload = deps.reload || defaultReload;
  const version = deps.version || packageVersion;

  const program = new Command();

  program
    .name('stagepass')
    .description('The missing link between Webflow and local dev.')
    .version(version);

  program
    .command('setup')
    .description('Install dependencies (Caddy, PHP, Dnsmasq) and configure .sp domain')
    .option('-v, --verbose', 'Show detailed installation logs')
    .action(async (options) => {
      try {
        await setup(options);
      } catch (error) {
        console.error(chalk.red('\nSetup failed.'));
        if (options.verbose) console.error(error);
        else console.error(chalk.dim('Run with -v for details.'));
      }
    });

  program
    .command('link')
    .description('Link current directory to a .sp domain')
    .argument('[domain]', 'Domain name (optional)')
    .option('-v, --verbose', 'Show Caddy reload output')
    .option(
      '--origin <host>',
      'Allow CORS from this live hostname (repeatable; e.g. example.com or *.example.com)',
      collectRepeatable,
      []
    )
    .option(
      '--remove-origin <host>',
      'Remove a previously stored CORS hostname (repeatable)',
      collectRepeatable,
      []
    )
    .option(
      '--allow-all-origins',
      'Allow CORS from any Origin (Access-Control-Allow-Origin: *). Insecure; prefer --origin.'
    )
    .option(
      '--no-allow-all-origins',
      'Disable allow-all CORS and use the origin allowlist'
    )
    .action(async (domain, options) => {
      await link(domain, options);
    });

  program
    .command('unlink')
    .description('Unlink current directory from .sp domain')
    .argument('[domain]', 'Domain name (optional, defaults to current folder name)')
    .option('-v, --verbose', 'Show Caddy reload output')
    .action(async (domain, options) => {
      await unlink(domain, options);
    });

  program
    .command('reload')
    .description('Reload Caddy configuration')
    .option('-v, --verbose', 'Show Caddy reload output')
    .action(async (options) => {
      await reload(options);
    });

  program
    .command('start')
    .description('Start background services (Caddy & PHP)')
    .option('-v, --verbose', 'Show detailed Caddy server logs')
    .action(async (options) => {
      await start(options);
    });

  program
    .command('stop')
    .description('Stop all background services')
    .option('-v, --verbose', 'Show detailed stop logs')
    .action(async (options) => {
      await stop(options);
    });

  return program;
}
