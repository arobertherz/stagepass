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
import {
  PACKAGES_MAJOR_RANGE,
  fetchPublished,
  installedHasPerModuleTypes,
  maxSatisfying,
  rangeHasPerModuleTypes,
  resolveSnippetLoaderVersion,
  satisfiesSimple,
} from '../lib/registry.js';
import { detectSite } from '../lib/site-detect.js';
import {
  applyProjectSync,
  planProjectSync,
  readStagepassJson,
  resolveUpgradeModules,
} from '../lib/project-sync.js';

const STAGEPASS_SCOPE = '@stagepass/';

const SAFE_SPEC_RE = /^[~^]?[0-9A-Za-z][0-9A-Za-z._+-]*$/;

/**
 * True when the version looks like an npm dist-tag (bare word, e.g. latest).
 * @param {string} version
 */
function isDistTag(version) {
  if (/^[0-9]/.test(version) || version.startsWith('^') || version.startsWith('~')) {
    return false;
  }
  if (version.includes('.')) return false;
  return /^[a-z][a-z0-9_-]*$/i.test(version);
}

/**
 * Resolve the range to write for one @stagepass/* package.
 *
 * Never writes a version or range that no published release satisfies
 * (releases can be staged but not yet approved, which gives ETARGET):
 * - default: `^<latest>` when latest is in the current major, else
 *   `^<highest published 2.x>`; `^2` when npm is unreachable
 * - `--version <semver|range>`: must match a published version
 * - `--version <dist-tag>`: the published version behind that tag
 *
 * @param {string} name
 * @param {string|undefined} requested
 * @param {{ distTags: Record<string, string>, versions: string[] } | null} published
 * @returns {{ spec: string, resolved: string | null, offline: boolean }}
 */
export function resolvePackageTarget(name, requested, published) {
  const value = requested == null ? '' : String(requested).trim().replace(/^v(?=\d)/i, '');
  if (value && !SAFE_SPEC_RE.test(value)) {
    throw new Error('Invalid --version value (use a semver, range prefix ^/~, or npm dist-tag).');
  }

  if (!value) {
    if (!published) return { spec: PACKAGES_MAJOR_RANGE, resolved: null, offline: true };
    const latest = published.distTags.latest;
    const best =
      latest && satisfiesSimple(latest, PACKAGES_MAJOR_RANGE)
        ? latest
        : maxSatisfying(published.versions, PACKAGES_MAJOR_RANGE);
    if (!best) return { spec: PACKAGES_MAJOR_RANGE, resolved: null, offline: false };
    return { spec: `^${best}`, resolved: best, offline: false };
  }

  if (!published) {
    throw new Error(
      `Could not check ${name}@${value} on npm (offline?). Retry online, or run without --version to use ${PACKAGES_MAJOR_RANGE}.`
    );
  }

  if (isDistTag(value)) {
    const tagged = published.distTags[value];
    if (!tagged) throw new Error(`${name} has no dist-tag "${value}".`);
    return { spec: tagged, resolved: tagged, offline: false };
  }

  const best = maxSatisfying(published.versions, value);
  if (!best) {
    throw new Error(
      `No published ${name} matches ${value} (staged releases cannot be installed until they are approved).`
    );
  }
  return { spec: value, resolved: best, offline: false };
}

/**
 * Resolve target ranges for every @stagepass/* dependency in package.json.
 *
 * @param {string|undefined} requested `--version`
 * @param {string[]} names package names
 * @param {object} [deps]
 * @param {(name: string) => Promise<{ distTags: Record<string, string>, versions: string[] } | null>} [deps.fetchPublished]
 * @param {import('../lib/exec.js').ExecFn} [deps.exec]
 * @returns {Promise<{ targets: Record<string, { spec: string, resolved: string | null, offline: boolean }>, published: Record<string, { distTags: Record<string, string>, versions: string[] } | null> }>}
 */
export async function resolveUpgradeTargets(requested, names, deps = {}) {
  const lookup =
    deps.fetchPublished || ((name) => fetchPublished(name, { exec: deps.exec || defaultExec }));
  /** @type {Record<string, any>} */
  const targets = {};
  /** @type {Record<string, any>} */
  const published = {};
  for (const name of [...new Set(names)]) {
    published[name] = await lookup(name);
    targets[name] = resolvePackageTarget(name, requested, published[name]);
  }
  return { targets, published };
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
 * @param {string | Record<string, string>} target one spec for all, or per package name
 * @returns {{ next: object, changes: { name: string, from: string, to: string, section: string }[] }}
 */
export function applyStagepassVersions(pkg, target) {
  const next = structuredClone(pkg);
  const changes = [];

  for (const { section, name, from } of findStagepassDeps(pkg)) {
    if (!next[section]) continue;
    const to = typeof target === 'string' ? target : target[name];
    if (!to) continue;
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
 * @param {(name: string) => Promise<{ distTags: Record<string, string>, versions: string[] } | null>} [deps.fetchPublished]
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

  const raw = await fse.readFile(pkgPath, 'utf8');
  let pkg;
  try {
    pkg = JSON.parse(raw);
  } catch {
    log(chalk.red('package.json is not valid JSON.'));
    return 1;
  }

  const names = findStagepassDeps(pkg).map((d) => d.name);
  let resolvedTargets;
  try {
    resolvedTargets = await resolveUpgradeTargets(options.version, names, {
      exec: deps.exec || defaultExec,
      fetchPublished: deps.fetchPublished,
    });
  } catch (error) {
    log(chalk.red(error instanceof Error ? error.message : String(error)));
    return 1;
  }
  const { targets, published } = resolvedTargets;
  /** @type {Record<string, string>} */
  const specs = Object.fromEntries(Object.entries(targets).map(([n, t]) => [n, t.spec]));
  if (Object.values(targets).some((t) => t.offline)) {
    log(chalk.yellow(`npm registry not reachable: using ${PACKAGES_MAJOR_RANGE} (resolves to the newest published 2.x).`));
  }

  const { next, changes } = applyStagepassVersions(pkg, specs);

  if (changes.length === 0) {
    if (names.length === 0) {
      log(chalk.yellow('No @stagepass/* packages found in package.json.'));
    } else {
      log(chalk.green('@stagepass/* already at the newest published ranges.'));
    }
  } else {
    log(chalk.bold('Upgrade @stagepass/* (published versions only)'));
    for (const change of changes) {
      log(`  ${change.name}: ${change.from} → ${change.to} (${change.section})`);
    }
  }

  // Per-module types need @stagepass/modules >= 2.2.0 resolvable from the range.
  /** @type {boolean | undefined} */
  let perModuleTypes;
  const modulesSpec =
    next?.dependencies?.['@stagepass/modules'] || next?.devDependencies?.['@stagepass/modules'];
  if (modulesSpec) {
    const fromRegistry = rangeHasPerModuleTypes(
      published['@stagepass/modules'] ? published['@stagepass/modules'].versions : null,
      String(modulesSpec)
    );
    perModuleTypes =
      fromRegistry != null ? fromRegistry : (await installedHasPerModuleTypes(cwd, fse)) === true;
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
      perModuleTypes,
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
  if (perModuleTypes === false && resolved.modules.length > 0 && !resolved.modules.includes('all')) {
    log(
      chalk.yellow(
        '  note: the published @stagepass/modules has no per-module types yet (needs 2.2.0); types use "@stagepass/modules". Run `stagepass upgrade` again once it is published.'
      )
    );
  }

  // Snippet: --version pin of loader on 2.x wins; resolve before writing so a failure changes nothing.
  let loaderPub = '@stagepass/loader' in published ? published['@stagepass/loader'] : undefined;
  const getLoaderPub = async () => {
    if (loaderPub !== undefined) return loaderPub;
    const lookup = deps.fetchPublished || ((name) => fetchPublished(name, { exec: deps.exec || defaultExec }));
    loaderPub = await lookup('@stagepass/loader');
    return loaderPub;
  };
  let snippetVersion = null;
  if (options.version != null) {
    let t = targets['@stagepass/loader'];
    if (!t) {
      try {
        t = resolvePackageTarget('@stagepass/loader', options.version, await getLoaderPub());
      } catch (e) {
        log(chalk.red(e instanceof Error ? e.message : String(e)));
        return 1;
      }
    }
    if (t.resolved && satisfiesSimple(t.resolved, PACKAGES_MAJOR_RANGE)) snippetVersion = t.resolved;
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

  if (!snippetVersion) {
    snippetVersion = await resolveSnippetLoaderVersion({
      published: await getLoaderPub(),
      cwd,
      bundled: STAGEPASS_PACKAGES_VERSION,
      fse,
    });
  }
  const snippets = buildWebflowSnippets({
    version: snippetVersion,
    moduleList: resolved.modules,
  });
  printWebflowSnippets(snippets, log);

  log(chalk.bold('\nNext step (not run automatically):'));
  log('  npm install');

  return 0;
}
