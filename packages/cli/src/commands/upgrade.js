import fs from 'fs-extra';
import path from 'path';
import chalk from 'chalk';
import { defaultExec } from '../lib/exec.js';
import {
  buildWebflowSnippets,
  printWebflowSnippets,
} from '../lib/snippets.js';

import { STAGEPASS_PACKAGES_VERSION } from '../lib/versions.js';

const STAGEPASS_SCOPE = '@stagepass/';

/**
 * True when the version looks like an npm dist-tag that needs resolution.
 * @param {string} version
 */
function needsNpmView(version) {
  if (!version) return false;
  // Semver-ish or range: treat as literal. Dist-tags are bare words.
  if (/^[0-9]/.test(version) || version.startsWith('^') || version.startsWith('~')) {
    return false;
  }
  if (version.includes('.')) return false;
  return /^[a-z][a-z0-9_-]*$/i.test(version);
}

/**
 * Resolve target version. Defaults to the @stagepass/loader + modules version
 * this CLI targets (not the CLI's own version, which can differ on CLI patches).
 * Contacts the network only when `--version` is an npm dist-tag (e.g. latest).
 *
 * @param {string|undefined} requested
 * @param {object} deps
 * @param {import('../lib/exec.js').ExecFn} [deps.exec]
 * @param {string} [deps.packagesVersion]
 * @param {string} [deps.cliVersion] Legacy alias for packagesVersion (tests)
 * @returns {Promise<string>}
 */
export async function resolveUpgradeVersion(requested, deps = {}) {
  const exec = deps.exec || defaultExec;
  const fallback =
    deps.packagesVersion || deps.cliVersion || STAGEPASS_PACKAGES_VERSION;

  if (!requested || String(requested).trim() === '') {
    return fallback;
  }

  const value = String(requested).trim();
  if (!needsNpmView(value)) {
    const literal = value.replace(/^v/i, '');
    // Keep package.json / snippet versions free of shell or HTML metacharacters.
    if (!/^[~^]?[0-9A-Za-z][0-9A-Za-z._+-]*$/.test(literal)) {
      throw new Error(
        'Invalid --version value (use a semver, range prefix ^/~, or npm dist-tag).'
      );
    }
    return literal;
  }

  const { stdout } = await exec('npm', ['view', `@stagepass/cli@${value}`, 'version']);
  const resolved = String(stdout || '').trim();
  if (!resolved) {
    throw new Error(`Could not resolve version for dist-tag "${value}".`);
  }
  if (!/^[~^]?[0-9A-Za-z][0-9A-Za-z._+-]*$/.test(resolved)) {
    throw new Error(`Resolved version looks unsafe: ${resolved}`);
  }
  return resolved;
}

/**
 * Collect @stagepass/* entries from dependencies and devDependencies.
 * @param {object} pkg
 * @returns {{ section: 'dependencies'|'devDependencies', name: string, from: string }[]}
 */
export function findStagepassDeps(pkg) {
  /** @type {{ section: 'dependencies'|'devDependencies', name: string, from: string }[]} */
  const found = [];
  for (const section of /** @type {const} */ (['dependencies', 'devDependencies'])) {
    const block = pkg[section];
    if (!block || typeof block !== 'object') continue;
    for (const [name, from] of Object.entries(block)) {
      if (name.startsWith(STAGEPASS_SCOPE)) {
        found.push({ section, name, from: String(from) });
      }
    }
  }
  return found;
}

/**
 * Rewrite @stagepass/* versions in a package.json object (mutates a copy).
 * @param {object} pkg
 * @param {string} targetVersion
 * @returns {{ next: object, changes: { name: string, from: string, to: string, section: string }[] }}
 */
export function applyStagepassVersions(pkg, targetVersion) {
  const next = structuredClone(pkg);
  const changes = [];
  const target = String(targetVersion);

  for (const { section, name, from } of findStagepassDeps(pkg)) {
    if (!next[section]) continue;
    const to = target;
    if (String(from) !== to) {
      changes.push({ name, from: String(from), to, section });
    }
    next[section][name] = to;
  }

  return { next, changes };
}

/**
 * Upgrade @stagepass/* deps in the current project's package.json.
 *
 * @param {object} [options]
 * @param {boolean} [options.dryRun]
 * @param {string} [options.version]
 * @param {object} [deps]
 * @param {typeof fs} [deps.fs]
 * @param {string} [deps.cwd]
 * @param {import('../lib/exec.js').ExecFn} [deps.exec]
 * @param {string} [deps.cliVersion]
 * @param {(msg?: string) => void} [deps.log]
 * @returns {Promise<number>} exit code
 */
export async function upgrade(options = {}, deps = {}) {
  const fse = deps.fs || fs;
  const cwd = deps.cwd || process.cwd();
  const log = deps.log || console.log;
  const pkgPath = path.join(cwd, 'package.json');

  if (!(await fse.pathExists(pkgPath))) {
    log(chalk.red('No package.json found in the current directory.'));
    return 1;
  }

  let targetVersion;
  try {
    targetVersion = await resolveUpgradeVersion(options.version, {
      exec: deps.exec || defaultExec,
      packagesVersion: deps.packagesVersion || deps.cliVersion,
    });
  } catch (error) {
    log(chalk.red(error instanceof Error ? error.message : String(error)));
    return 1;
  }

  const raw = await fse.readFile(pkgPath, 'utf8');
  let pkg;
  try {
    pkg = JSON.parse(raw);
  } catch {
    log(chalk.red('package.json is not valid JSON.'));
    return 1;
  }

  const { next, changes } = applyStagepassVersions(pkg, targetVersion);
  const hasModules = Boolean(
    next.dependencies?.['@stagepass/modules'] ||
      next.devDependencies?.['@stagepass/modules']
  );

  if (changes.length === 0) {
    const existing = findStagepassDeps(pkg);
    if (existing.length === 0) {
      log(chalk.yellow('No @stagepass/* packages found in package.json.'));
    } else {
      log(chalk.green(`@stagepass/* already at ${targetVersion}.`));
    }
  } else {
    log(chalk.bold(`Upgrade @stagepass/* → ${targetVersion}`));
    for (const change of changes) {
      log(`  ${change.name}: ${change.from} → ${change.to} (${change.section})`);
    }

    if (options.dryRun) {
      log(chalk.dim('\nDry run: package.json was not modified.'));
    } else {
      const trailingNewline = raw.endsWith('\n');
      const body = `${JSON.stringify(next, null, 2)}${trailingNewline ? '\n' : ''}`;
      await fse.writeFile(pkgPath, body, 'utf8');
      log(chalk.green('\nUpdated package.json.'));
    }
  }

  const snippets = buildWebflowSnippets({
    version: targetVersion,
    modules: hasModules,
  });
  printWebflowSnippets(snippets, log);

  log(chalk.bold('\nNext step (not run automatically):'));
  log('  npm install');

  return 0;
}
