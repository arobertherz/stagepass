#!/usr/bin/env node

import { createRequire } from 'module';
import { program } from 'commander';
import chalk from 'chalk';
import { setup } from '../src/commands/setup.js';
import { link } from '../src/commands/link.js';
import { unlink } from '../src/commands/unlink.js';
import { start } from '../src/commands/start.js';
import { stop } from '../src/commands/stop.js';
import { reload } from '../src/commands/reload.js';

const require = createRequire(import.meta.url);
const { version } = require('../package.json');

function collectOrigin(value, previous) {
  return previous.concat([value]);
}

program
  .name('stagepass')
  .description('The missing link between Webflow and local dev.')
  .version(version);

// Command: SETUP
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

// Command: LINK
program
  .command('link')
  .description('Link current directory to a .sp domain')
  .argument('[domain]', 'Domain name (optional)')
  .option('-v, --verbose', 'Show Caddy reload output')
  .option(
    '--origin <host>',
    'Allow CORS from this live hostname (repeatable; e.g. example.com or *.example.com)',
    collectOrigin,
    []
  )
  .option(
    '--allow-all-origins',
    'Allow CORS from any Origin (Access-Control-Allow-Origin: *). Insecure; prefer --origin. Use --no-allow-all-origins to disable.'
  )
  .action(async (domain, options) => {
    await link(domain, options);
  });

// Command: UNLINK
program
  .command('unlink')
  .description('Unlink current directory from .sp domain')
  .argument('[domain]', 'Domain name (optional, defaults to current folder name)')
  .option('-v, --verbose', 'Show Caddy reload output')
  .action(async (domain, options) => {
    await unlink(domain, options);
  });

// Command: RELOAD
program
  .command('reload')
  .description('Reload Caddy configuration')
  .option('-v, --verbose', 'Show Caddy reload output')
  .action(async (options) => {
    await reload(options);
  });

// Command: START
program
  .command('start')
  .description('Start background services (Caddy & PHP)')
  .option('-v, --verbose', 'Show detailed Caddy server logs')
  .action(async (options) => {
    await start(options);
  });

// Command: STOP
program
  .command('stop')
  .description('Stop all background services')
  .option('-v, --verbose', 'Show detailed stop logs')
  .action(async (options) => {
    await stop(options);
  });

program.parse(process.argv);
