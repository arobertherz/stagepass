import { createRequire } from 'module';
import { Command } from 'commander';
import chalk from 'chalk';
import { setup as defaultSetup } from './commands/setup.js';
import { link as defaultLink } from './commands/link.js';
import { unlink as defaultUnlink } from './commands/unlink.js';
import { start as defaultStart } from './commands/start.js';
import { stop as defaultStop } from './commands/stop.js';
import { reload as defaultReload } from './commands/reload.js';
import { doctor as defaultDoctor } from './commands/doctor.js';
import {
  certsCheck as defaultCertsCheck,
  certsTrust as defaultCertsTrust,
} from './commands/certs.js';
import { autostart as defaultAutostart } from './commands/autostart.js';
import { daemon as defaultDaemon } from './commands/daemon.js';
import { upgrade as defaultUpgrade } from './commands/upgrade.js';
import {
  watch as defaultWatch,
  build as defaultBuild,
} from './commands/npm-run.js';
import { createNew as defaultCreateNew } from './commands/new.js';
import { assertSupportedPlatform } from './lib/platform.js';

const require = createRequire(import.meta.url);
const { version: packageVersion } = require('../package.json');

function collectRepeatable(value, previous) {
  return previous.concat([value]);
}

/**
 * Commander reserves root `--version` for the CLI version. Rewrite
 * `stagepass upgrade --version <x>` to `--target` so the subcommand receives it.
 * `stagepass --version` is unchanged.
 *
 * @param {string[]} argv
 * @returns {string[]}
 */
export function rewriteArgvForUpgrade(argv) {
  const out = [...argv];
  // Prefer the first bare `upgrade` token after node/script.
  let idx = -1;
  for (let i = 2; i < out.length; i++) {
    if (out[i] === 'upgrade') {
      idx = i;
      break;
    }
    if (!String(out[i]).startsWith('-')) break;
  }
  if (idx === -1) return out;

  for (let i = idx + 1; i < out.length; i++) {
    if (out[i] === '--version' && out[i + 1] && !String(out[i + 1]).startsWith('-')) {
      out[i] = '--target';
      break;
    }
    if (out[i] === '--') break;
  }
  return out;
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
 * @param {typeof defaultDoctor} [deps.doctor]
 * @param {typeof defaultCertsCheck} [deps.certsCheck]
 * @param {typeof defaultCertsTrust} [deps.certsTrust]
 * @param {typeof defaultAutostart} [deps.autostart]
 * @param {typeof defaultDaemon} [deps.daemon]
 * @param {typeof defaultUpgrade} [deps.upgrade]
 * @param {typeof defaultWatch} [deps.watch]
 * @param {typeof defaultBuild} [deps.build]
 * @param {typeof defaultCreateNew} [deps.createNew]
 * @param {string} [deps.version]
 * @param {() => void} [deps.assertPlatform]
 */
export function createProgram(deps = {}) {
  const setup = deps.setup || defaultSetup;
  const link = deps.link || defaultLink;
  const unlink = deps.unlink || defaultUnlink;
  const start = deps.start || defaultStart;
  const stop = deps.stop || defaultStop;
  const reload = deps.reload || defaultReload;
  const doctor = deps.doctor || defaultDoctor;
  const certsCheck = deps.certsCheck || defaultCertsCheck;
  const certsTrust = deps.certsTrust || defaultCertsTrust;
  const autostart = deps.autostart || defaultAutostart;
  const daemon = deps.daemon || defaultDaemon;
  const upgrade = deps.upgrade || defaultUpgrade;
  const watch = deps.watch || defaultWatch;
  const build = deps.build || defaultBuild;
  const createNew = deps.createNew || defaultCreateNew;
  const version = deps.version || packageVersion;
  const assertPlatform =
    deps.assertPlatform || (() => assertSupportedPlatform());

  const program = new Command();

  program
    .name('stagepass')
    .description('The missing link between Webflow and local dev.')
    .version(version);

  // Runs before every system command action. --help / --version never hit this.
  program.hook('preAction', () => {
    assertPlatform();
  });

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

  // --- Package 2: CLI operations (doctor, certs, autostart, daemon) ---
  // Keep this block self-contained for easy merges with other cli.js changes.
  program
    .command('doctor')
    .description('Diagnose the local Stagepass stack (read-only; never uses sudo)')
    .option('-v, --verbose', 'Show extra detail for ok checks')
    .option('--json', 'Machine-readable JSON output')
    .action(async (options) => {
      const code = await doctor(options);
      process.exitCode = code;
    });

  const certsCmd = program
    .command('certs')
    .description('Certificate helpers for the Caddy local CA');

  certsCmd
    .command('check')
    .description('Check Caddy local CA validity, trust, and optional TLS handshakes (read-only)')
    .option('-v, --verbose', 'Show detailed output')
    .option('--json', 'Machine-readable JSON output')
    .option('--skip-handshake', 'Skip per-domain TLS handshake checks')
    .action(async (options) => {
      const code = await certsCheck(options);
      process.exitCode = code;
    });

  certsCmd
    .command('trust')
    .description('Trust the Caddy local root CA via `caddy trust` (confirmation required)')
    .option('-y, --yes', 'Skip interactive confirmation')
    .option('-v, --verbose', 'Show detailed output')
    .action(async (options) => {
      const code = await certsTrust(options);
      process.exitCode = code;
    });

  program
    .command('autostart')
    .description('Manage login LaunchAgent for Stagepass (macOS)')
    .argument('<action>', 'on | off | status')
    .option('-v, --verbose', 'Show detailed output')
    .option('--json', 'JSON output for status')
    .action(async (action, options) => {
      const normalized = String(action || '').toLowerCase();
      if (!['on', 'off', 'status'].includes(normalized)) {
        console.error(chalk.red('Usage: stagepass autostart on|off|status'));
        process.exitCode = 1;
        return;
      }
      const code = await autostart(normalized, options);
      process.exitCode = code;
    });

  program
    .command('daemon')
    .description('Foreground daemon for LaunchAgent (non-interactive; never uses sudo)')
    .action(async () => {
      const code = await daemon();
      process.exitCode = code;
    });

  // --- Package 3: project scaffold / npm wrappers / upgrade ---
  // Keep this block self-contained for easy merges with other cli.js changes.
  program
    .command('upgrade')
    .description(
      'Bump @stagepass/* in the current package.json and print Webflow snippets'
    )
    .option('--dry-run', 'Show changes without writing package.json')
    .option(
      '--target <version>',
      'Target version (default: this CLI version; dist-tags use npm view)'
    )
    // Public docs use `--version`; rewriteArgvForUpgrade maps it to `--target`
    // so it does not collide with the root `stagepass --version` handler.
    .option('-v, --verbose', 'Show detailed output')
    .action(async (options) => {
      const code = await upgrade({
        ...options,
        version: options.target,
      });
      process.exitCode = code;
    });

  program
    .command('watch')
    .description('Run `npm run watch` in the current project')
    .option('-v, --verbose', 'Show the underlying npm command')
    .action(async (options) => {
      const code = await watch(options);
      process.exitCode = code;
    });

  program
    .command('build')
    .description('Run `npm run build` in the current project')
    .option('-v, --verbose', 'Show the underlying npm command')
    .action(async (options) => {
      const code = await build(options);
      process.exitCode = code;
    });

  program
    .command('new')
    .description('Scaffold a new Stagepass Webflow project')
    .argument('[name]', 'DNS-safe project name')
    .option('--dir <dir>', 'Target directory (default: ./<name>)')
    .option('--author <author>', 'Author for package.json (default: git user.name)')
    .option('--lang <lang>', 'ts or js (default: ts)')
    .option('--styles <styles>', 'scss or css (default: scss)')
    .option('--modules', 'Include @stagepass/modules')
    .option('--no-modules', 'Skip @stagepass/modules')
    .option('--git', 'Initialize a git repository')
    .option('--no-git', 'Do not initialize git')
    .option('--remote <url>', 'Git remote URL (requires git)')
    .option('--install', 'Run npm install after scaffolding')
    .option('--no-install', 'Do not run npm install (default)')
    .option('-y, --yes', 'Non-interactive; accept defaults for omitted flags')
    .option('--dry-run', 'Print the file plan without writing')
    .option('-v, --verbose', 'Show detailed output')
    .action(async (name, options) => {
      const code = await createNew(name, options);
      process.exitCode = code;
    });

  return program;
}
