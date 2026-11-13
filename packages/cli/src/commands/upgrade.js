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
import { detectSite, normalizeSiteUrl } from '../lib/site-detect.js';
import {
  applyProjectSync,
  phpFromStagepassConfig,
  planProjectSync,
  readStagepassJson,
  resolveUpgradeModules,
} from '../lib/project-sync.js';
import {
  defaultBuildScriptTemplatePath,
  planBuildScriptUpgrade,
} from '../lib/build-script-upgrade.js';
import { planHtaccessUpgrade } from '../lib/htaccess-upgrade.js';

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

function packageHas(pkg, name) {
  for (const section of ['dependencies', 'devDependencies']) {
    const block = pkg?.[section];
    if (block && typeof block === 'object' && !Array.isArray(block) && Object.prototype.hasOwnProperty.call(block, name)) {
      return true;
    }
  }
  return false;
}

/**
 * Add type packages the project does not already depend on.
 * Loader is always required. `@stagepass/modules` only when the declared list is non-empty.
 * Does not run npm install.
 * @param {object} pkg
 * @param {string[]} modules normalized declared list
 * @param {Record<string, string>} specs name to version spec
 * @returns {{ next: object, added: { name: string, to: string, section: 'devDependencies' }[] }}
 */
export function ensureTypeDevDependencies(pkg, modules, specs) {
  const next = structuredClone(pkg);
  /** @type {{ name: string, to: string, section: 'devDependencies' }[]} */
  const added = [];
  const names = ['@stagepass/loader'];
  if (Array.isArray(modules) && modules.length > 0) names.push('@stagepass/modules');
  for (const name of names) {
    if (packageHas(next, name)) continue;
    const to = specs?.[name];
    if (!to) continue;
    if (next.devDependencies == null) next.devDependencies = {};
    if (typeof next.devDependencies !== 'object' || Array.isArray(next.devDependencies)) continue;
    next.devDependencies[name] = to;
    added.push({ name, to, section: 'devDependencies' });
  }
  return { next, added };
}

/**
 * Upgrade @stagepass/* deps in the current project's package.json and sync
 * the declared modules into stagepass.json, AGENTS.stagepass.md, the short
 * pointer in AGENTS.md, the Cursor rule and editor types (a plain `types`
 * array, or stagepass.d.ts). Adds missing `@stagepass/loader` and, when
 * modules are declared, `@stagepass/modules` devDependencies. Replaces
 * scripts/build.mjs when it is still an unmodified scaffold from an earlier
 * CLI, and replaces a hand-edited AGENTS.stagepass.md, when the user passed
 * `--yes` or confirmed on a TTY. Without a TTY and without `--yes`, prints
 * a hint and leaves that file. A managed AGENTS.stagepass.md is refreshed
 * without asking. When stagepass.json has `"php": true`
 * and the project root has no `.htaccess`, writes the shipped template.
 * It does not copy `api/` when that boilerplate is missing.
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

  // Validate --site before any registry / network access (no partial side effects).
  if (options.site) {
    const siteCheck = normalizeSiteUrl(options.site);
    if (!siteCheck.ok) {
      log(chalk.red(siteCheck.error));
      return 1;
    }
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

  let { next, changes } = applyStagepassVersions(pkg, specs);

  if (changes.length > 0) {
    log(chalk.bold('Upgrade @stagepass/* (published versions only)'));
    for (const change of changes) {
      log(`  ${change.name}: ${change.from} → ${change.to} (${change.section})`);
    }
  } else if (names.length > 0) {
    log(chalk.green('@stagepass/* already at the newest published ranges.'));
  }

  // Declared modules: live site first, then stagepass.json, then ask.
  const sp = await readStagepassJson(cwd, fse);
  if (sp.error) log(chalk.yellow(sp.error));
  const isTty = deps.isTTY != null ? Boolean(deps.isTTY) : Boolean(input.isTTY && output.isTTY);
  const assumeYes = options.yes === true;
  const interactive = isTty && !assumeYes;
  /** @type {import('node:readline/promises').Interface | null} */
  let rl = null;
  const getRl = () => {
    if (!rl) rl = deps.createReadline?.() || readline.createInterface({ input, output });
    return rl;
  };
  const closeRl = () => {
    if (!rl) return;
    rl.close();
    rl = null;
  };
  const ask = async (question, def) => {
    const answer = await getRl().question(`${question} (${def}): `);
    const trimmed = String(answer || '').trim();
    return trimmed === '' ? def : trimmed;
  };
  const confirmFn = async (question, defYes) => {
    const answer = await getRl().question(`${question} (${defYes ? 'Y/n' : 'y/N'}): `);
    const t = String(answer || '').trim().toLowerCase();
    if (t === '') return defYes;
    return ['y', 'yes'].includes(t);
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
        ask,
        confirm: confirmFn,
      }
    );
  } finally {
    closeRl();
  }
  if (!resolved.ok) {
    log(chalk.red(resolved.error));
    return 1;
  }

  const typeNames = ['@stagepass/loader'];
  if (resolved.modules.length > 0) typeNames.push('@stagepass/modules');
  const missingTypes = typeNames.filter((name) => !packageHas(next, name));
  /** @type {{ name: string, to: string, section: 'devDependencies' }[]} */
  let added = [];
  if (missingTypes.length > 0) {
    let extra;
    try {
      extra = await resolveUpgradeTargets(options.version, missingTypes, {
        exec: deps.exec || defaultExec,
        fetchPublished: deps.fetchPublished,
      });
    } catch (error) {
      log(chalk.red(error instanceof Error ? error.message : String(error)));
      return 1;
    }
    Object.assign(published, extra.published);
    const typeSpecs = Object.fromEntries(Object.entries(extra.targets).map(([name, target]) => [name, target.spec]));
    const ensured = ensureTypeDevDependencies(next, resolved.modules, typeSpecs);
    next = ensured.next;
    added = ensured.added;
    const alreadyOffline = Object.values(targets).some((target) => target.offline);
    if (!alreadyOffline && Object.values(extra.targets).some((target) => target.offline)) {
      log(chalk.yellow(`npm registry not reachable: using ${PACKAGES_MAJOR_RANGE} (resolves to the newest published 2.x).`));
    }
  }
  if (added.length > 0) {
    log(chalk.bold('Type packages (devDependencies)'));
    for (const item of added) log(`  ${item.name}: add ${item.to} (${item.section})`);
  } else if (names.length === 0 && changes.length === 0) {
    log(chalk.yellow('No @stagepass/* packages found in package.json.'));
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

  const plan = await planProjectSync(
    {
      cwd,
      modules: resolved.modules,
      origin: options.site ? resolved.origin : null,
      pkg: next,
      perModuleTypes,
      interactive,
      assumeYes,
      confirm: confirmFn,
    },
    fse
  );

  // Refuse an unpublished --version before asking about scripts/build.mjs or writing.
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

  /** @type {{ action: string, from?: string, content?: string, note?: string }} */
  let buildUpgrade = { action: 'skipped' };
  try {
    let currentBuild;
    try {
      currentBuild = await fse.readFile(defaultBuildScriptTemplatePath(), 'utf8');
    } catch (error) {
      buildUpgrade = {
        action: 'unreadable',
        note: `Could not read the scaffold build script (${error instanceof Error ? error.message : String(error)}). The project script was left unchanged.`,
      };
      currentBuild = null;
    }
    if (currentBuild != null) {
      buildUpgrade = await planBuildScriptUpgrade({
        cwd,
        currentSource: currentBuild,
        interactive,
        assumeYes,
        confirm: confirmFn,
        fse,
      });
    }
    if (buildUpgrade.action === 'update' && buildUpgrade.content) {
      plan.writes.push({
        file: 'scripts/build.mjs',
        content: buildUpgrade.content,
        action: `replace unmodified scaffold (${buildUpgrade.from})`,
      });
    }
  } finally {
    closeRl();
  }

  // Missing PHP .htaccess only. An existing path is never replaced.
  const htaccessPlan = await planHtaccessUpgrade({
    cwd,
    php: phpFromStagepassConfig(sp.data),
    fse,
  });
  if (htaccessPlan.action === 'create') {
    plan.writes.push({
      file: '.htaccess',
      content: htaccessPlan.content,
      action: 'created',
    });
  } else if (htaccessPlan.note) {
    plan.notes.push(htaccessPlan.note);
  }

  log(chalk.bold(`\nProject files for modules: ${resolved.modules.length ? resolved.modules.join(', ') : 'none'}`));
  if (plan.writes.length === 0 && buildUpgrade.action !== 'hint') {
    log('  Everything is up to date.');
  }
  for (const w of plan.writes) {
    log(`  ${w.file}: ${w.action}`);
  }
  for (const note of plan.notes) {
    log(chalk.yellow(`  note: ${note}`));
  }
  if (buildUpgrade.action === 'custom') {
    log(chalk.yellow(buildUpgrade.note));
  } else if (buildUpgrade.action !== 'update' && buildUpgrade.note) {
    const warn =
      buildUpgrade.action === 'declined' ||
      buildUpgrade.action === 'symlink' ||
      buildUpgrade.action === 'unreadable' ||
      buildUpgrade.action === 'hint';
    const line = `  ${buildUpgrade.note}`;
    log(warn ? chalk.yellow(line) : line);
  }
  if (perModuleTypes === false && resolved.modules.length > 0 && !resolved.modules.includes('all')) {
    log(
      chalk.yellow(
        '  note: the published @stagepass/modules has no per-module types yet (needs 2.2.0); types use "@stagepass/modules". Run `stagepass upgrade` again once it is published.'
      )
    );
  }

  if (options.dryRun) {
    log(chalk.dim('\nDry run: no files were modified.'));
  } else {
    try {
      const pkgChanged = changes.length > 0 || added.length > 0;
      if (pkgChanged) {
        try {
          if ((await fse.lstat(pkgPath)).isSymbolicLink()) {
            log(chalk.red('package.json is a symlink; refusing to write.'));
            return 1;
          }
        } catch {
          /* missing / unreadable: writeFile will surface the error */
        }
        const trailingNewline = raw.endsWith('\n');
        const pkgBody = `${JSON.stringify(next, null, 2)}${trailingNewline ? '\n' : ''}`;
        await fse.writeFile(pkgPath, pkgBody, 'utf8');
        log(chalk.green('\nUpdated package.json.'));
      }
      await applyProjectSync(cwd, plan.writes, fse);
      if (plan.writes.length > 0) log(chalk.green(`Updated ${plan.writes.length} project file(s).`));
    } catch (err) {
      // Restore package.json if project-sync failed after the pkg write.
      try {
        if (changes.length > 0 || added.length > 0) await fse.writeFile(pkgPath, raw, 'utf8');
      } catch {
        /* best effort */
      }
      log(chalk.red(err instanceof Error ? err.message : String(err)));
      if (options.verbose === true && err instanceof Error && err.stack) log(err.stack);
      return 1;
    }
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
  const typesTouched =
    added.length > 0 ||
    plan.writes.some(
      (item) => item.file === 'tsconfig.json' || item.file === 'jsconfig.json' || item.file.endsWith('stagepass.d.ts')
    );
  if (typesTouched) log('  TypeScript: Restart TS Server');

  return 0;
}
