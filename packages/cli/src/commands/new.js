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
} from '../lib/registry.js';
import { updateConfigTypes } from '../lib/project-sync.js';

const PER_MODULE_TYPES_HINT =
  '@stagepass/modules on npm has no per-module types yet (needs 2.2.0); ' +
  'types use "@stagepass/modules" for now. Run `stagepass upgrade` once it is published to narrow them.';

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
  if (options.site != null && String(options.site).trim() !== '') {
    const check = normalizeSiteUrl(String(options.site));
    if (!check.ok) return { ok: false, error: check.error };
    origin = check.host;
  }

  /**
   * Detect modules on the live site (public GET, never executed).
   * @returns {Promise<string[] | null>} detected list, or null when unknown
   */
  const detectFromSite = async () => {
    if (!origin) return null;
    log(`Checking live site https://${origin}/ for Stagepass script tags...`);
    const det = await detect(origin);
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
      if (siteModules === undefined && modules !== false) {
        if (!origin) {
          const raw = await ask(rl, 'Live Webflow site to check (optional, e.g. my-project.webflow.io)', '');
          if (raw) {
            const check = normalizeSiteUrl(raw);
            if (check.ok) origin = check.host;
            else log(chalk.yellow(`  ${check.error} Skipping the live check.`));
          }
        }
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
      if (git === undefined) {
        git = await askYesNo(rl, 'Initialize git repository?', true);
      }
      if (git && !remote) {
        remote = await ask(rl, 'Git remote URL (optional)', '');
      }
      if (install === undefined) {
        install = await askYesNo(rl, 'Run npm install now?', false);
      }
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

  if (lang !== 'ts' && lang !== 'js') {
    return { ok: false, error: 'Language must be ts or js.' };
  }
  if (styles !== 'scss' && styles !== 'css') {
    return { ok: false, error: 'Styles must be scss or css.' };
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
 * After `npm install`, align tsconfig/jsconfig types with the installed
 * @stagepass/modules (per-module entries only when it ships them).
 *
 * @param {string} targetDir
 * @param {{ siteModules: string[], perModuleTypes?: boolean }} config
 * @param {typeof fs} fse
 * @param {(msg?: string) => void} log
 */
async function reconcileInstalledTypes(targetDir, config, fse, log) {
  const installed = await installedHasPerModuleTypes(targetDir, fse);
  if (installed === null || installed === (config.perModuleTypes !== false)) return;
  for (const name of ['tsconfig.json', 'jsconfig.json']) {
    const file = path.join(targetDir, name);
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
    return 0;
  }

  await fse.ensureDir(targetDir);

  for (const file of files) {
    const abs = path.resolve(targetDir, file.relativePath);
    const relToTarget = path.relative(targetDir, abs);
    if (
      relToTarget.startsWith('..') ||
      path.isAbsolute(relToTarget) ||
      relToTarget.split(path.sep).includes('..')
    ) {
      error(chalk.red(`Refusing to write outside project directory: ${file.relativePath}`));
      return 1;
    }
    await fse.ensureDir(path.dirname(abs));
    await fse.writeFile(abs, file.contents, 'utf8');
  }

  if (config.git) {
    try {
      await exec('git', ['init'], { cwd: targetDir });
      if (config.remote) {
        await exec('git', ['remote', 'add', 'origin', config.remote], {
          cwd: targetDir,
        });
      }
    } catch (err) {
      error(
        chalk.red(
          `Git setup failed: ${err instanceof Error ? err.message : String(err)}`
        )
      );
      return 1;
    }
  }

  if (config.install) {
    try {
      const result = await spawn('npm', ['install'], {
        cwd: targetDir,
        stdio: 'inherit',
        shell: false,
        env: process.env,
      });
      if (result.code !== 0) {
        error(chalk.red(`npm install exited with code ${result.code}`));
        return typeof result.code === 'number' ? result.code : 1;
      }
      if (singleModuleTypes) {
        await reconcileInstalledTypes(targetDir, config, fse, log);
      }
    } catch (err) {
      error(
        chalk.red(
          `npm install failed: ${err instanceof Error ? err.message : String(err)}`
        )
      );
      return 1;
    }
  }

  log(chalk.green(`Created Stagepass project at ${targetDir}`));
  log(chalk.dim('Next:'));
  if (!config.install) {
    log(`  cd ${path.relative(cwd, targetDir) || '.'} && npm install`);
  }
  log('  npm run build');
  log(`  stagepass link ${config.name} --origin ${config.origin || 'my-project.webflow.io'}`);
  log(chalk.dim(`Declared modules (stagepass.json): ${formatModules(config.siteModules)}`));

  const snippets = buildWebflowSnippets({
    version: config.loaderVersion,
    moduleList: config.siteModules,
  });
  printWebflowSnippets(snippets, log);

  return 0;
}

/** Commander-facing alias */
export const newProject = createNew;
