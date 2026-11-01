import fs from 'fs-extra';
import path from 'node:path';
import readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import chalk from 'chalk';
import { createRequire } from 'module';
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

const require = createRequire(import.meta.url);
const { version: cliVersion } = require('../../package.json');

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
      if (modules === undefined) {
        modules = await askYesNo(rl, 'Include @stagepass/modules?', true);
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
  }

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
      git,
      remote: remoteCheck.remote,
      install,
      dryRun: options.dryRun === true,
      loaderVersion: deps.cliVersion || cliVersion,
    },
  };
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
    return fse.readFile(abs, 'utf8');
  };

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
  log(`  stagepass link ${config.name} --origin my-project.webflow.io`);

  const snippets = buildWebflowSnippets({
    version: config.loaderVersion,
    modules: config.modules,
  });
  printWebflowSnippets(snippets, log);

  return 0;
}

/** Commander-facing alias */
export const newProject = createNew;
