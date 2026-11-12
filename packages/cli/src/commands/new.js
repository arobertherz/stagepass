import fs from 'fs-extra';
import path from 'node:path';
import readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import chalk from 'chalk';
import { defaultExec } from '../lib/exec.js';
import { defaultSpawn } from '../lib/spawn.js';
import { validateProjectName } from '../lib/project-name.js';
import { validateGitRemote } from '../lib/remote-url.js';
import {
  defaultTemplatesRoot,
  planScaffoldFiles,
  findConflicts,
  assertScaffoldParentPath,
  writeScaffoldFiles,
  rollbackScaffold,
} from '../lib/scaffold.js';
import {
  buildWebflowSnippets,
  printWebflowSnippets,
} from '../lib/snippets.js';

import { STAGEPASS_PACKAGES_VERSION } from '../lib/versions.js';
import { formatModules, normalizeModulesList } from '../lib/project-modules.js';
import { describeDetection, detectSite, normalizeSiteUrl } from '../lib/site-detect.js';
import {
  PACKAGES_MAJOR_RANGE,
  fetchPublished,
  installedHasPerModuleTypes,
  rangeHasPerModuleTypes,
  resolveSnippetLoaderVersion,
} from '../lib/registry.js';
import { updateConfigTypes } from '../lib/project-sync.js';
import { validateOriginEntry, isBroadWebflowWildcard } from '../lib/origins.js';
import { isMacOS } from '../lib/platform.js';
import { checkPhpRuntime, phpOriginsHint, phpProjectWarning } from '../lib/php-runtime.js';
import { runDoctor } from '../lib/doctor.js';
import { setup as defaultSetup } from './setup.js';
import { link as defaultLink } from './link.js';

const PER_MODULE_TYPES_HINT =
  '@stagepass/modules on npm has no per-module types yet (needs 2.2.0); ' +
  'types use "@stagepass/modules" for now. Run `stagepass upgrade` once it is published to narrow them.';

const PRODUCTION_HINT =
  'Production domain skipped. Add it later with: stagepass link --origin example.com';

/** Core stack check ids that mean setup is likely needed. */
const SETUP_CHECK_IDS = new Set(['homebrew', 'caddy', 'dnsmasq', 'resolver']);

/**
 * Resolve a boolean flag that may appear as --foo / --no-foo.
 * Only argv is trusted: Commander defaults negated pairs to true, which would
 * break defaults like --install (off unless passed).
 *
 * @param {object} _options
 * @param {string} key
 * @param {string[]} argv
 * @param {boolean|undefined} defaultValue undefined = still unset
 */
export function resolveBoolFlag(_options, key, argv, defaultValue) {
  const pos = `--${key}`;
  const neg = `--no-${key}`;
  if (argv.includes(neg)) return false;
  if (argv.includes(pos)) return true;
  return defaultValue;
}

/**
 * @param {string|undefined} raw
 * @param {string} label
 * @returns {{ ok: true, value: string } | { ok: true, value: '' } | { ok: false, error: string }}
 */
export function parseOriginFlag(raw, label) {
  // Empty means "not set". Whitespace-only must fail via validateOriginEntry (AC-10).
  if (raw == null || String(raw) === '') {
    return { ok: true, value: '' };
  }
  const check = validateOriginEntry(String(raw));
  if (!check.ok) {
    return { ok: false, error: `Invalid --${label}: ${check.error}` };
  }
  return { ok: true, value: check.value };
}

/**
 * @param {import('../lib/doctor.js').DoctorCheck[] | { id: string, status: string }[]} checks
 * @returns {boolean}
 */
export function doctorSuggestsSetup(checks) {
  return (checks || []).some(
    (c) => SETUP_CHECK_IDS.has(c.id) && (c.status === 'fail' || c.status === 'warn')
  );
}

/**
 * @param {object} options Commander options
 * @param {object} [deps]
 */
async function resolveAuthor(options, deps) {
  if (options.author != null && String(options.author).trim() !== '') {
    return String(options.author).trim();
  }
  const exec = deps.exec || defaultExec;
  try {
    const { stdout } = await exec('git', ['config', 'user.name']);
    return String(stdout || '').trim();
  } catch {
    return '';
  }
}

/**
 * @param {import('node:readline/promises').Interface} rl
 * @param {string} question
 * @param {string} [defaultValue]
 */
async function ask(rl, question, defaultValue = '') {
  const suffix = defaultValue ? ` (${defaultValue})` : '';
  const answer = await rl.question(`${question}${suffix}: `);
  const trimmed = String(answer || '').trim();
  return trimmed === '' ? defaultValue : trimmed;
}

/**
 * @param {import('node:readline/promises').Interface} rl
 * @param {string} question
 * @param {boolean} defaultYes
 */
async function askYesNo(rl, question, defaultYes) {
  const hint = defaultYes ? 'Y/n' : 'y/N';
  const answer = await rl.question(`${question} (${hint}): `);
  const trimmed = String(answer || '').trim().toLowerCase();
  if (trimmed === '') return defaultYes;
  if (['y', 'yes'].includes(trimmed)) return true;
  if (['n', 'no'].includes(trimmed)) return false;
  return defaultYes;
}

/**
 * Merge flags + optional interactive prompts into a resolved config.
 * @param {string|undefined} nameArg
 * @param {object} options
 * @param {object} deps
 */
export async function resolveNewOptions(nameArg, options = {}, deps = {}) {
  const isTty =
    deps.isTTY != null ? Boolean(deps.isTTY) : Boolean(input.isTTY);
  const interactive = isTty && options.yes !== true;
  const authorDefault = await resolveAuthor(options, deps);
  const argv = Array.isArray(deps.argv) ? deps.argv : process.argv;

  /** @type {string} */
  let name = nameArg ? String(nameArg).trim() : '';
  /** @type {string} */
  let dir = options.dir != null ? String(options.dir) : '';
  let lang = options.lang === 'js' || options.lang === 'ts' ? options.lang : '';
  let styles =
    options.styles === 'css' || options.styles === 'scss' ? options.styles : '';

  // Prefer argv for --foo / --no-foo so Commander default quirks do not flip defaults.
  let modules = resolveBoolFlag(options, 'modules', argv, undefined);
  let git = resolveBoolFlag(options, 'git', argv, undefined);
  let install = resolveBoolFlag(options, 'install', argv, undefined);
  let php = resolveBoolFlag(options, 'php', argv, undefined);
  let phpExamples = resolveBoolFlag(options, 'php-examples', argv, undefined);
  if (phpExamples === undefined) {
    phpExamples = resolveBoolFlag(options, 'phpExamples', argv, undefined);
  }
  let linkAtEnd = resolveBoolFlag(options, 'link', argv, undefined);
  let remote = options.remote != null ? String(options.remote).trim() : '';
  const log = deps.log || console.log;
  const detect = deps.detectSite || detectSite;

  /** @type {string[] | undefined} */
  let siteModules;
  if (options.siteModules != null) {
    const parsed = normalizeModulesList(String(options.siteModules));
    if (!parsed.ok) return { ok: false, error: parsed.error };
    siteModules = parsed.modules;
  }

  /** @type {string} */
  let origin = '';
  /** @type {string} */
  let production = '';
  /** @type {boolean} */
  let productionSkipped = false;

  // Pass raw flag values (no trim): whitespace/controls must abort before write/network.
  const siteFlag = options.site != null && String(options.site) !== '' ? String(options.site) : '';
  const stagingFlag =
    options.staging != null && String(options.staging) !== '' ? String(options.staging) : '';

  if (siteFlag) {
    const check = normalizeSiteUrl(siteFlag);
    if (!check.ok) return { ok: false, error: check.error };
    origin = check.host;
  }
  if (stagingFlag) {
    const check = parseOriginFlag(stagingFlag, 'staging');
    if (!check.ok) return check;
    if (origin && origin !== check.value) {
      return {
        ok: false,
        error: `--site (${origin}) and --staging (${check.value}) disagree. Pass only one, or matching values.`,
      };
    }
    origin = check.value;
  }
  if (options.production != null && String(options.production) !== '') {
    const check = parseOriginFlag(String(options.production), 'production');
    if (!check.ok) return check;
    production = check.value;
  } else if (
    Object.prototype.hasOwnProperty.call(options, 'production') &&
    (options.production === '' || options.production == null) &&
    !interactive
  ) {
    productionSkipped = true;
  }

  /**
   * Detect modules on the live site (public GET, never executed).
   * @returns {Promise<string[] | null>} detected list, or null when unknown
   */
  const detectFromSite = async () => {
    if (!origin) return null;
    // Wildcards are valid CORS origins but not fetchable site hosts.
    if (origin.startsWith('*.')) {
      log(chalk.dim(`  Staging ${origin} is a wildcard; skipping live module detection.`));
      return null;
    }
    const siteCheck = normalizeSiteUrl(origin);
    if (!siteCheck.ok) {
      log(chalk.dim(`  ${siteCheck.error} Skipping live module detection.`));
      return null;
    }
    log(`Checking live site https://${siteCheck.host}/ for Stagepass script tags...`);
    const det = await detect(siteCheck.host);
    log(`  ${describeDetection(det)}`);
    if (det.ok && det.loader) return det.list;
    if (det.ok) log('  The page does not load @stagepass/loader yet.');
    return null;
  };

  if (interactive) {
    const rl =
      deps.createReadline?.() ||
      readline.createInterface({ input, output });
    try {
      if (!name) {
        name = await ask(rl, 'Project name (DNS-safe)');
      }
      if (!dir) {
        dir = await ask(rl, 'Directory', name || '.');
      }
      if (!options.author) {
        const nextAuthor = await ask(rl, 'Author', authorDefault);
        options = { ...options, author: nextAuthor };
      }
      if (!lang) {
        const raw = await ask(rl, 'Language (ts|js)', 'ts');
        lang = raw === 'js' ? 'js' : 'ts';
      }
      if (!styles) {
        const raw = await ask(rl, 'Styles (scss|css)', 'scss');
        styles = raw === 'css' ? 'css' : 'scss';
      }
      if (!origin) {
        const suggested = name ? `${String(name).trim().toLowerCase()}.webflow.io` : '';
        const raw = await ask(
          rl,
          'Staging domain (e.g. my-project.webflow.io)',
          suggested
        );
        if (raw) {
          const check = validateOriginEntry(raw);
          if (check.ok) {
            origin = check.value;
            if (isBroadWebflowWildcard(origin)) {
              log(
                chalk.yellow(
                  `  Warning: ${origin} allows any Webflow user's site (CORS). Prefer a concrete staging host.`
                )
              );
            }
          } else {
            log(chalk.yellow(`  ${check.error} Skipping staging origin.`));
          }
        }
      }
      if (!production) {
        const raw = await ask(rl, 'Production domain (optional)', '');
        if (raw) {
          const check = validateOriginEntry(raw);
          if (check.ok) {
            production = check.value;
            if (isBroadWebflowWildcard(production)) {
              log(
                chalk.yellow(
                  `  Warning: ${production} is a broad wildcard; prefer an exact production host.`
                )
              );
            }
          } else {
            log(chalk.yellow(`  ${check.error} Skipping production origin.`));
            productionSkipped = true;
          }
        } else {
          productionSkipped = true;
        }
      }
      if (siteModules === undefined && modules !== false) {
        const detected = await detectFromSite();
        if (detected && (await askYesNo(rl, `Use modules detected on the site: ${formatModules(detected)}?`, true))) {
          siteModules = detected;
        }
        while (siteModules === undefined) {
          const raw = await ask(
            rl,
            'Modules your Webflow site loads (none | all | inject,cookies,maintenance)',
            detected ? formatModules(detected) : 'none'
          );
          const parsed = normalizeModulesList(raw);
          if (parsed.ok) siteModules = parsed.modules;
          else log(chalk.yellow(`  ${parsed.error}`));
        }
      }
      if (php === undefined) {
        php = await askYesNo(rl, 'Enable PHP for this project?', false);
      }
      if (git === undefined) {
        git = await askYesNo(rl, 'Initialize git repository?', true);
      }
      if (git && !remote) {
        remote = await ask(rl, 'Git remote URL (optional)', '');
      }
      if (install === undefined) {
        install = await askYesNo(rl, 'Run npm install now?', false);
      }
      // Asked after create on macOS only when the link flag was omitted.
    } finally {
      rl.close();
    }
  } else if (siteModules === undefined && modules !== false) {
    const detected = await detectFromSite();
    if (detected) {
      siteModules = detected;
      log(`Modules: ${formatModules(detected)} (detected on ${origin}; change "modules" in stagepass.json if needed).`);
    }
  }

  if (siteModules === undefined) {
    siteModules = [];
    if (!interactive && modules !== false) {
      log(chalk.dim('Modules: none declared. Pass --site <host> or --site-modules <list>, or edit stagepass.json and run stagepass upgrade.'));
    }
  }
  if (modules === false && siteModules.length > 0) {
    return {
      ok: false,
      error: '--no-modules conflicts with declared site modules. Drop --no-modules or pass --site-modules none.',
    };
  }
  // The npm package (types) follows the declared list; keep the legacy default (included).
  if (siteModules.length > 0) modules = true;

  // Non-interactive / --yes defaults
  if (!name) {
    return { ok: false, error: 'Project name is required (pass [name] or use a TTY).' };
  }
  const nameCheck = validateProjectName(name);
  if (!nameCheck.ok) {
    return { ok: false, error: nameCheck.error };
  }
  name = nameCheck.name;

  if (!dir) dir = name;
  if (!lang) lang = 'ts';
  if (!styles) styles = 'scss';
  if (modules === undefined) modules = true;
  if (git === undefined) git = true;
  if (install === undefined) install = false;
  if (php === undefined) php = false;
  if (phpExamples === undefined) phpExamples = false;
  if (linkAtEnd == null && !interactive) linkAtEnd = false;

  if (lang !== 'ts' && lang !== 'js') {
    return { ok: false, error: 'Language must be ts or js.' };
  }
  if (styles !== 'scss' && styles !== 'css') {
    return { ok: false, error: 'Styles must be scss or css.' };
  }
  if (phpExamples) {
    log(
      chalk.yellow(
        '--php-examples is deprecated. Sample actions (ping, contact) are included with --php under api/actions/. This flag no longer copies examples/php/.'
      )
    );
  }

  const remoteCheck = validateGitRemote(remote);
  if (!remoteCheck.ok) {
    return { ok: false, error: remoteCheck.error };
  }
  if (remoteCheck.remote && !git) {
    return {
      ok: false,
      error: 'A git remote requires git init. Pass --git or omit --no-git.',
    };
  }

  const author =
    options.author != null && String(options.author).trim() !== ''
      ? String(options.author).trim()
      : authorDefault;

  if (!production) productionSkipped = true;

  return {
    ok: true,
    config: {
      name,
      dir,
      author,
      lang,
      styles,
      modules,
      siteModules,
      origin: origin || undefined,
      production: production || undefined,
      productionSkipped,
      php,
      phpExamples,
      linkAtEnd,
      git,
      remote: remoteCheck.remote,
      install,
      dryRun: options.dryRun === true,
      loaderVersion:
        deps.packagesVersion || deps.cliVersion || STAGEPASS_PACKAGES_VERSION,
    },
  };
}

/**
 * True when `p` exists (lstat; does not follow the final symlink).
 * @param {{ lstat: (p: string) => Promise<unknown> }} fse
 * @param {string} p
 */
async function pathExistsLstat(fse, p) {
  try {
    await fse.lstat(p);
    return true;
  } catch (err) {
    if (err && /** @type {{ code?: string }} */ (err).code === 'ENOENT') return false;
    throw err;
  }
}

/**
 * After `npm install`, align tsconfig/jsconfig types with the installed
 * @stagepass/modules (per-module entries only when it ships them).
 * Only rewrites configs this run created (INV-4: never mutate pre-existing files).
 *
 * @param {string} targetDir
 * @param {{ siteModules: string[], perModuleTypes?: boolean }} config
 * @param {typeof fs} fse
 * @param {(msg?: string) => void} log
 * @param {string[]} [createdPaths] absolute paths this run may rewrite
 */
async function reconcileInstalledTypes(targetDir, config, fse, log, createdPaths) {
  const installed = await installedHasPerModuleTypes(targetDir, fse);
  if (installed === null || installed === (config.perModuleTypes !== false)) return;
  const created =
    createdPaths == null ? null : new Set(createdPaths.map((p) => path.resolve(p)));
  for (const name of ['tsconfig.json', 'jsconfig.json']) {
    const file = path.resolve(targetDir, name);
    if (created && !created.has(file)) continue;
    if (!(await fse.pathExists(file))) continue;
    const raw = await fse.readFile(file, 'utf8');
    const result = updateConfigTypes(raw, config.siteModules, {
      modulesDependency: true,
      perModuleTypes: installed,
    });
    if (result.status === 'updated' && result.content) {
      await fse.writeFile(file, result.content, 'utf8');
      log(chalk.dim(`${name}: types ${result.types.join(', ')} (matches installed @stagepass/modules)`));
    }
  }
  if (!installed) log(chalk.yellow(PER_MODULE_TYPES_HINT));
}

/**
 * Interactive macOS preflight: read-only doctor, optionally offer setup.
 * Never runs under --yes / no-TTY. Never uses sudo by itself.
 *
 * @param {object} deps
 * @returns {Promise<number>} 0 continue, 1 abort
 */
async function maybeDoctorPreflight(deps = {}) {
  const isTty = deps.isTTY != null ? Boolean(deps.isTTY) : Boolean(input.isTTY);
  if (!isTty || deps.yes === true) return 0;

  const platform = deps.platform || process.platform;
  if (!isMacOS(platform)) return 0;

  const log = deps.log || console.log;
  const error = deps.error || console.error;
  const run = deps.runDoctor || runDoctor;

  log(chalk.dim('Running read-only doctor preflight…'));
  let report;
  try {
    report = await run({
      skipHandshake: true,
      projectChecks: false,
      exec: deps.exec,
      pathExists: deps.pathExists,
      readFile: deps.readFile,
    });
  } catch (err) {
    error(
      chalk.yellow(
        `Doctor preflight failed: ${err instanceof Error ? err.message : String(err)}`
      )
    );
    return 0;
  }

  const { summary, checks } = report;
  log(
    chalk.dim(
      `Doctor: ${summary.ok} ok, ${summary.warn} warn, ${summary.fail} fail`
    )
  );

  if (!doctorSuggestsSetup(checks)) return 0;

  const rl =
    deps.createReadline?.() ||
    readline.createInterface({ input, output });
  try {
    const runSetup = await askYesNo(
      rl,
      'Local Stagepass stack looks incomplete. Run `stagepass setup` now?',
      false
    );
    if (!runSetup) {
      log(chalk.dim('Skipping setup. You can run `stagepass setup` later.'));
      return 0;
    }
    const setupFn = deps.setup || defaultSetup;
    await setupFn({ verbose: deps.verbose === true });
    return 0;
  } finally {
    rl.close();
  }
}

/**
 * Optionally link the new project (macOS only; --link, or ask when unset).
 *
 * @param {object} config
 * @param {string} targetDir
 * @param {object} deps
 */
async function maybeLinkProject(config, targetDir, deps = {}) {
  const log = deps.log || console.log;
  const platform = deps.platform || process.platform;
  if (!isMacOS(platform)) {
    if (config.linkAtEnd) {
      log(chalk.dim('Skipping link (macOS only).'));
    }
    return;
  }

  let shouldLink = config.linkAtEnd;
  const isTty = deps.isTTY != null ? Boolean(deps.isTTY) : Boolean(input.isTTY);
  if (shouldLink == null && isTty && deps.yes !== true) {
    const rl =
      deps.createReadline?.() ||
      readline.createInterface({ input, output });
    try {
      shouldLink = await askYesNo(
        rl,
        `Link this project as ${config.name}.sp now?`,
        false
      );
    } finally {
      rl.close();
    }
  }

  if (!shouldLink) return 0;

  const linkFn = deps.link || defaultLink;
  log(chalk.dim(`Linking ${config.name}.sp…`));
  const linkCode = await linkFn(
    config.name,
    { verbose: deps.verbose === true },
    { cwd: targetDir, log }
  );
  if (typeof linkCode === 'number' && linkCode !== 0) {
    log(
      chalk.red(
        `stagepass link failed (exit ${linkCode}). Project files were kept; fix the error and run \`stagepass link\` again.`
      )
    );
    return linkCode;
  }
  return 0;
}

/**
 * Scaffold a new Stagepass project.
 *
 * @param {string|undefined} nameArg
 * @param {object} [options]
 * @param {object} [deps]
 * @returns {Promise<number>} exit code
 */
export async function createNew(nameArg, options = {}, deps = {}) {
  const fse = deps.fs || fs;
  const exec = deps.exec || defaultExec;
  const spawn = deps.spawn || defaultSpawn;
  const log = deps.log || console.log;
  const error = deps.error || console.error;
  const cwd = deps.cwd || process.cwd();
  const templatesRoot = deps.templatesRoot || defaultTemplatesRoot();

  const resolved = await resolveNewOptions(nameArg, options, deps);
  if (!resolved.ok) {
    error(chalk.red(resolved.error));
    return 1;
  }

  const config = resolved.config;

  // Doctor/setup only after validation, never for --dry-run (no side effects).
  if (config.dryRun !== true) {
    const preflightDeps = {
      ...deps,
      yes: options.yes === true,
      verbose: options.verbose === true,
      log,
      error,
    };
    const preflightCode = await maybeDoctorPreflight(preflightDeps);
    if (preflightCode !== 0) return preflightCode;
  }
  const targetDir = path.isAbsolute(config.dir)
    ? config.dir
    : path.resolve(cwd, config.dir);

  const templatesRootResolved = path.resolve(templatesRoot);
  const readTemplate = async (rel) => {
    const abs = path.resolve(templatesRootResolved, rel);
    const relToRoot = path.relative(templatesRootResolved, abs);
    if (
      relToRoot.startsWith('..') ||
      path.isAbsolute(relToRoot) ||
      relToRoot.split(path.sep).includes('..')
    ) {
      throw new Error(`Template path escapes templates root: ${rel}`);
    }
    try {
      return await fse.readFile(abs, 'utf8');
    } catch (err) {
      if (err && err.code === 'ENOENT') {
        throw new Error(
          `Template "${rel}" is missing from the @stagepass/cli install (${templatesRootResolved}). ` +
            'Reinstall the CLI (npm install -g @stagepass/cli) and try again. Nothing was written.'
        );
      }
      throw err;
    }
  };

  // Single-module types (`@stagepass/modules/cookies`) exist since modules
  // 2.2.0. Only use them when a published release in range ships them;
  // otherwise (or offline) fall back to the umbrella types so tsc passes.
  const singleModuleTypes =
    config.modules === true &&
    config.siteModules.length > 0 &&
    !config.siteModules.includes('all');
  if (singleModuleTypes && !config.dryRun) {
    const published = await (deps.fetchPublished || fetchPublished)('@stagepass/modules', { exec });
    config.perModuleTypes =
      rangeHasPerModuleTypes(published ? published.versions : null, PACKAGES_MAJOR_RANGE) === true;
    if (!config.perModuleTypes) log(chalk.yellow(PER_MODULE_TYPES_HINT));
  }

  // Snippets pin the resolved loader, never the CLI version (AC-14).
  if (!config.dryRun) {
    const loader = await (deps.fetchPublished || fetchPublished)('@stagepass/loader', { exec });
    config.loaderVersion = await resolveSnippetLoaderVersion({
      published: loader,
      cwd: targetDir,
      bundled: config.loaderVersion,
      fse,
    });
  }

  let files;
  try {
    files = await planScaffoldFiles(config, { readTemplate });
  } catch (err) {
    error(chalk.red(err instanceof Error ? err.message : String(err)));
    return 1;
  }

  for (const file of files) {
    const rel = String(file.relativePath || '');
    if (
      !rel ||
      path.isAbsolute(rel) ||
      rel.split(/[\\/]/).includes('..')
    ) {
      error(chalk.red(`Refusing unsafe output path: ${rel || '(empty)'}`));
      return 1;
    }
  }

  const parentCheck = await assertScaffoldParentPath(targetDir, fse);
  if (!parentCheck.ok) {
    error(chalk.red(parentCheck.error));
    return 1;
  }

  const conflicts = await findConflicts(targetDir, files, fse);
  if (conflicts.length > 0) {
    error(chalk.red('Refusing to overwrite existing files:'));
    for (const rel of conflicts) {
      error(`  ${rel}`);
    }
    return 1;
  }

  if (config.dryRun) {
    log(chalk.bold(`Dry run: would create project in ${targetDir}`));
    for (const file of files) {
      log(`  ${file.relativePath}`);
    }
    if (config.git) log('  (git init)');
    if (config.remote) log(`  (git remote add origin ${config.remote})`);
    if (config.install) log('  (npm install)');
    if (config.linkAtEnd) log('  (stagepass link)');
    if (config.productionSkipped) log(`  (${PRODUCTION_HINT})`);
    await reportPhpChoice(config, deps, log);
    return 0;
  }

  const written = await writeScaffoldFiles(targetDir, files, fse);
  if (!written.ok) {
    error(chalk.red(written.error));
    if (options.verbose === true && written.errorObj instanceof Error && written.errorObj.stack) {
      error(written.errorObj.stack);
    }
    return 1;
  }

  /** Roll back every file this run created (INV-4). */
  const undo = async () => rollbackScaffold(written.created, written.createdTargetDir, fse);

  if (config.git) {
    const gitDir = path.join(targetDir, '.git');
    const gitExisted = await pathExistsLstat(fse, gitDir);
    try {
      await exec('git', ['init'], { cwd: targetDir });
      if (config.remote) {
        await exec('git', ['remote', 'add', 'origin', config.remote], {
          cwd: targetDir,
        });
      }
      if (!gitExisted) written.created.push(gitDir);
    } catch (err) {
      if (!gitExisted) written.created.push(gitDir);
      await undo();
      error(
        chalk.red(
          `Git setup failed: ${err instanceof Error ? err.message : String(err)}`
        )
      );
      if (options.verbose === true && err instanceof Error && err.stack) error(err.stack);
      return 1;
    }
  }

  if (config.install) {
    const nodeModulesDir = path.join(targetDir, 'node_modules');
    const lockfile = path.join(targetDir, 'package-lock.json');
    const nodeModulesExisted = await pathExistsLstat(fse, nodeModulesDir);
    const lockfileExisted = await pathExistsLstat(fse, lockfile);
    const trackInstallArtifacts = () => {
      if (!nodeModulesExisted) written.created.push(nodeModulesDir);
      if (!lockfileExisted) written.created.push(lockfile);
    };
    try {
      const result = await spawn('npm', ['install'], {
        cwd: targetDir,
        stdio: 'inherit',
        shell: false,
        env: process.env,
      });
      trackInstallArtifacts();
      if (result.code !== 0) {
        await undo();
        error(chalk.red(`npm install exited with code ${result.code}`));
        return 1;
      }
      if (singleModuleTypes) {
        await reconcileInstalledTypes(targetDir, config, fse, log, written.created);
      }
    } catch (err) {
      trackInstallArtifacts();
      await undo();
      error(
        chalk.red(
          `npm install failed: ${err instanceof Error ? err.message : String(err)}`
        )
      );
      if (options.verbose === true && err instanceof Error && err.stack) error(err.stack);
      return 1;
    }
  }

  log(chalk.green(`Created Stagepass project at ${targetDir}`));
  log(chalk.dim('Next:'));
  if (!config.install) {
    log(`  cd ${path.relative(cwd, targetDir) || '.'} && npm install`);
  }
  log('  npm run build');
  if (config.origin || config.production) {
    log(`  stagepass link ${config.name}`);
  } else {
    log(`  stagepass link ${config.name} --origin my-project.webflow.io`);
  }
  if (config.productionSkipped) {
    log(chalk.dim(PRODUCTION_HINT));
  }
  log(chalk.dim(`Declared modules (stagepass.json): ${formatModules(config.siteModules)}`));
  log(chalk.dim(`PHP: ${config.php ? 'on' : 'off'}`));
  await reportPhpChoice(config, deps, log);

  const snippets = buildWebflowSnippets({
    version: config.loaderVersion,
    moduleList: config.siteModules,
  });
  printWebflowSnippets(snippets, log);

  const linkCode = await maybeLinkProject(config, targetDir, {
    ...deps,
    yes: options.yes === true,
    verbose: options.verbose === true,
    log,
  });
  if (typeof linkCode === 'number' && linkCode !== 0) return linkCode;

  return 0;
}

/**
 * Origins hint plus a non-fatal PHP 8.2 / php-fpm check. The project is kept either way.
 * @param {{ php?: boolean, name: string }} config
 * @param {object} deps
 * @param {(msg?: string) => void} log
 */
async function reportPhpChoice(config, deps, log) {
  if (config.php !== true) return;
  log(chalk.dim(phpOriginsHint(config.name)));
  try {
    const runtime = await checkPhpRuntime({
      exec: deps.exec,
      platform: deps.platform,
      pathExists: deps.pathExists,
      resolveCommand: deps.resolveCommand,
      brewPrefix: deps.brewPrefix,
    });
    if (!runtime.ok) {
      log(chalk.yellow(phpProjectWarning(runtime, `${config.name}.sp`)));
    }
  } catch {
    log(chalk.yellow('PHP could not be checked. The project was still created.'));
  }
}

/** Commander-facing alias */
export const newProject = createNew;
