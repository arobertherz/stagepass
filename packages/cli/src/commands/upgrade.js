import fs from 'fs-extra';
import path from 'path';
import chalk from 'chalk';
import { defaultExec } from '../lib/exec.js';
import {
  buildWebflowSnippets,
  printWebflowSnippets,
} from '../lib/snippets.js';

import readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import { STAGEPASS_PACKAGES_VERSION } from '../lib/versions.js';
import { detectSite } from '../lib/site-detect.js';
import {
  applyProjectSync,
  planProjectSync,
  readStagepassJson,
  resolveUpgradeModules,
} from '../lib/project-sync.js';

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
 * Upgrade @stagepass/* deps in the current project's package.json and sync
 * the declared modules into stagepass.json, AGENTS.md, the Cursor rule and
 * tsconfig/jsconfig types.
 *
 * @param {object} [options]
 * @param {boolean} [options.dryRun]
 * @param {string} [options.version]
 * @param {string} [options.site] live Webflow host to detect modules from
 * @param {string} [options.siteModules] none | all | comma list
 * @param {boolean} [options.skipSite]
 * @param {boolean} [options.yes]
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
  }

  // Declared modules: live site first, then stagepass.json, then ask.
  const sp = await readStagepassJson(cwd, fse);
  if (sp.error) log(chalk.yellow(sp.error));
  const isTty = deps.isTTY != null ? Boolean(deps.isTTY) : Boolean(input.isTTY && output.isTTY);
  const interactive = isTty && options.yes !== true;
  /** @type {import('node:readline/promises').Interface | null} */
  let rl = null;
  const getRl = () => {
    if (!rl) rl = deps.createReadline?.() || readline.createInterface({ input, output });
    return rl;
  };
  let resolved;
  try {
    resolved = await resolveUpgradeModules(
      { cwd, data: sp.data, pkg: next, options },
      {
        detectSite: deps.detectSite || detectSite,
        loadProjects: deps.loadProjects,
        interactive,
        log,
        ask: async (question, def) => {
          const answer = await getRl().question(`${question} (${def}): `);
          const trimmed = String(answer || '').trim();
          return trimmed === '' ? def : trimmed;
        },
        confirm: async (question, defYes) => {
          const answer = await getRl().question(`${question} (${defYes ? 'Y/n' : 'y/N'}): `);
          const t = String(answer || '').trim().toLowerCase();
          if (t === '') return defYes;
          return ['y', 'yes'].includes(t);
        },
      }
    );
  } finally {
    if (rl) rl.close();
  }
  if (!resolved.ok) {
    log(chalk.red(resolved.error));
    return 1;
  }

  const plan = await planProjectSync(
    {
      cwd,
      modules: resolved.modules,
      origin: options.site ? resolved.origin : null,
      pkg: next,
    },
    fse
  );

  log(chalk.bold(`\nProject files for modules: ${resolved.modules.length ? resolved.modules.join(', ') : 'none'}`));
  if (plan.writes.length === 0) {
    log('  Everything is up to date.');
  }
  for (const w of plan.writes) {
    log(`  ${w.file}: ${w.action}`);
  }
  for (const note of plan.notes) {
    log(chalk.yellow(`  note: ${note}`));
  }

  if (options.dryRun) {
    log(chalk.dim('\nDry run: no files were modified.'));
  } else {
    if (changes.length > 0) {
      const trailingNewline = raw.endsWith('\n');
      const pkgBody = `${JSON.stringify(next, null, 2)}${trailingNewline ? '\n' : ''}`;
      await fse.writeFile(pkgPath, pkgBody, 'utf8');
      log(chalk.green('\nUpdated package.json.'));
    }
    await applyProjectSync(cwd, plan.writes, fse);
    if (plan.writes.length > 0) log(chalk.green(`Updated ${plan.writes.length} project file(s).`));
  }

  const snippets = buildWebflowSnippets({
    version: targetVersion,
    moduleList: resolved.modules,
  });
  printWebflowSnippets(snippets, log);

  log(chalk.bold('\nNext step (not run automatically):'));
  log('  npm install');

  return 0;
}
