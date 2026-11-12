import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildWebflowSnippets } from './snippets.js';
import { CURSOR_RULE_PATH, buildCursorRule, buildManagedBlock } from './ai-guide.js';
import { typesForModules } from './project-modules.js';
import { LOADER_VERSION, packagesRange } from './versions.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/** Absolute path to packaged templates/project */
export function defaultTemplatesRoot() {
  return path.join(__dirname, '../../templates/project');
}

/**
 * Template file → output path. Dotfiles are stored without the leading dot
 * because npm pack / publish drops `.gitignore` (and `.npmignore`) files.
 * Never add a template whose name starts with `.` (a test enforces this).
 *
 * @param {'ts'|'js'} lang
 * @param {'scss'|'css'} styles
 * @returns {{ template: string, out: string }[]}
 */
export function scaffoldTemplateMap(lang, styles) {
  const isTs = lang === 'ts';
  const useSass = styles === 'scss';
  return [
    { template: 'scripts/build.mjs', out: 'scripts/build.mjs' },
    { template: 'gitignore', out: '.gitignore' },
    { template: 'README.md.tmpl', out: 'README.md' },
    { template: 'AGENTS.md.tmpl', out: 'AGENTS.md' },
    { template: 'stagepass.json.tmpl', out: 'stagepass.json' },
    {
      template: isTs ? 'src/main.ts.tmpl' : 'src/main.js.tmpl',
      out: isTs ? 'src/main.ts' : 'src/main.js',
    },
    {
      template: useSass ? 'src/styles.scss.tmpl' : 'src/styles.css.tmpl',
      out: useSass ? 'src/styles.scss' : 'src/styles.css',
    },
    {
      template: isTs ? 'tsconfig.json.tmpl' : 'jsconfig.json.tmpl',
      out: isTs ? 'tsconfig.json' : 'jsconfig.json',
    },
  ];
}

/**
 * Boilerplate files when PHP is enabled.
 * Dot paths are renamed in the package (npm pack drops dotfiles) and restored on write.
 * `phpExamples` is ignored: sample actions live in api/actions/.
 * @param {{ php?: boolean, phpExamples?: boolean }} options
 * @returns {{ template: string, out: string }[]}
 */
export function scaffoldPhpTemplateMap(options = {}) {
  if (options.php !== true) return [];
  return [
    { template: 'api/README.md.tmpl', out: 'api/README.md' },
    { template: 'api/action.php', out: 'api/action.php' },
    { template: 'api/actions.php', out: 'api/actions.php' },
    { template: 'api/actions/ping.php', out: 'api/actions/ping.php' },
    { template: 'api/actions/contact.php', out: 'api/actions/contact.php' },
    { template: 'api/actions/boom.php', out: 'api/actions/boom.php' },
    { template: 'api/lib/bootstrap.php', out: 'api/lib/bootstrap.php' },
    { template: 'api/lib/config.php', out: 'api/lib/config.php' },
    { template: 'api/lib/request.php', out: 'api/lib/request.php' },
    { template: 'api/lib/response.php', out: 'api/lib/response.php' },
    { template: 'api/lib/security.php', out: 'api/lib/security.php' },
    { template: 'api/lib/validate.php', out: 'api/lib/validate.php' },
    { template: 'api/env.example', out: 'api/.env.example' },
    { template: 'php-private/config.php', out: '.php/config.php' },
  ];
}

/**
 * @typedef {object} ScaffoldOptions
 * @property {string} name
 * @property {string} dir Absolute or relative target directory
 * @property {string} [author]
 * @property {'ts'|'js'} lang
 * @property {'scss'|'css'} styles
 * @property {boolean} modules Add @stagepass/modules to devDependencies
 * @property {string[]} [siteModules] Declared modules the Webflow site loads (stagepass.json)
 * @property {string} [origin] Staging / primary live host (stagepass.json `origin`)
 * @property {string} [production] Optional production host (stagepass.json `production`)
 * @property {boolean} [php] Enable PHP FastCGI for the linked .sp site (default false for new)
 * @property {boolean} [phpExamples] Deprecated. Accepted and ignored; actions ship in api/actions/.
 * @property {boolean} git
 * @property {string} [remote]
 * @property {boolean} install
 * @property {boolean} dryRun
 * @property {string} [loaderVersion] @stagepass/loader + modules version (snippets)
 * @property {string} [packagesRange] Override for package.json ranges (default ^<major>, e.g. ^2)
 * @property {boolean} [perModuleTypes] false: use the umbrella `@stagepass/modules` types (modules < 2.2.0)
 */

/**
 * @param {ScaffoldOptions} options
 * @returns {Record<string, string>}
 */
export function buildPackageJson(options) {
  // Never derive the range from the CLI or target version: a release can be
  // staged but unpublished (ETARGET). The major range matches the @2 embeds.
  const range = options.packagesRange || packagesRange(LOADER_VERSION);
  const isTs = options.lang === 'ts';
  const useSass = options.styles === 'scss';

  /** @type {Record<string, string>} */
  const devDependencies = {
    '@stagepass/loader': range,
    esbuild: '^0.25.0',
  };

  if (options.modules) {
    devDependencies['@stagepass/modules'] = range;
  }
  if (isTs) {
    devDependencies.typescript = '^5.6.0';
  }
  if (useSass) {
    devDependencies.sass = '^1.80.0';
  }

  return {
    name: options.name,
    private: true,
    version: '0.0.0',
    description: `Stagepass project ${options.name}`,
    author: options.author || '',
    type: 'module',
    scripts: {
      build: 'node scripts/build.mjs',
      watch: 'node scripts/build.mjs --watch',
      // Prefer `stagepass dev` for live reload on the linked .sp domain.
      dev: 'npm run watch',
    },
    devDependencies,
  };
}

/**
 * Apply {{TOKEN}} replacements. Unknown tokens left intact.
 * @param {string} source
 * @param {Record<string, string>} vars
 */
export function applyTemplate(source, vars) {
  return source.replace(/\{\{([A-Z0-9_]+)\}\}/g, (match, key) => {
    if (Object.prototype.hasOwnProperty.call(vars, key)) {
      return vars[key];
    }
    return match;
  });
}

/**
 * Extra JSON lines for stagepass.json (leading commas / newlines).
 * @param {ScaffoldOptions} options
 */
export function buildStagepassExtraLines(options) {
  const lines = [];
  if (options.origin) {
    lines.push(`\n  "origin": ${JSON.stringify(options.origin)},`);
  }
  if (options.production) {
    lines.push(`\n  "production": ${JSON.stringify(options.production)},`);
  }
  // Always record php for new projects so link/doctor can tell intentional off from legacy.
  lines.push(`\n  "php": ${options.php === true ? 'true' : 'false'},`);
  return lines.join('');
}

/**
 * Plan files to write for a scaffold (relative paths → contents).
 * @param {ScaffoldOptions} options
 * @param {object} [deps]
 * @param {(rel: string) => Promise<string>} [deps.readTemplate]
 * @returns {Promise<{ relativePath: string, contents: string }[]>}
 */
export async function planScaffoldFiles(options, deps = {}) {
  const version = options.loaderVersion || LOADER_VERSION;
  const isTs = options.lang === 'ts';
  const useSass = options.styles === 'scss';
  const entryJs = isTs ? 'src/main.ts' : 'src/main.js';
  const entryCss = useSass ? 'src/styles.scss' : 'src/styles.css';
  const configFile = isTs ? 'tsconfig.json' : 'jsconfig.json';
  const php = options.php === true;
  const stagingHost = options.origin || `${options.name}.webflow.io`;

  const siteModules = Array.isArray(options.siteModules) ? options.siteModules : [];
  const snippets = buildWebflowSnippets({
    version,
    moduleList: siteModules,
  });
  const types = typesForModules(siteModules, {
    modulesDependency: options.modules === true,
    perModuleTypes: options.perModuleTypes,
  });

  const vars = {
    NAME: options.name,
    AUTHOR: options.author || '',
    LANG: options.lang,
    STYLES: options.styles,
    MODULES_JSON: JSON.stringify(siteModules),
    ORIGIN_LINE: buildStagepassExtraLines(options),
    TYPES_JSON: JSON.stringify(types),
    TYPES_INLINE: JSON.stringify(types).replace(/","/g, '", "'),
    STAGEPASS_BLOCK: buildManagedBlock(siteModules),
    LOADER_VERSION: version,
    HEAD_SNIPPET: snippets.head,
    FOOTER_SNIPPET: snippets.footer,
    ENTRY_JS: entryJs,
    ENTRY_CSS: entryCss,
    USE_SASS: useSass ? 'true' : 'false',
    CONFIG_FILE: configFile,
    STAGING_HOST: stagingHost,
    PRODUCTION_HOST: options.production || '',
    PHP_ENABLED: php ? 'true' : 'false',
    PHP_SECTION: php
      ? [
          '## PHP',
          '',
          `PHP is on. Caddy serves \`https://${options.name}.sp/api/action.php\` with \`php_fastcgi\`.`,
          'Read `api/README.md`. Copy `api/.env.example` to `.env` (do not commit it) and set `ALLOWED_ORIGINS` to exact origins, including that `.sp` URL.',
          '',
        ].join('\n')
      : [
          '## PHP',
          '',
          'PHP is **off** for this project (no `php_fastcgi` in the Caddy site block). Enable later by setting `"php": true` in `stagepass.json` and re-running `stagepass link`.',
          '',
        ].join('\n'),
  };

  const readTemplate =
    deps.readTemplate ||
    (async () => {
      throw new Error('readTemplate dependency required');
    });

  /** @type {{ relativePath: string, contents: string }[]} */
  const files = [];

  const pkg = buildPackageJson(options);
  files.push({
    relativePath: 'package.json',
    contents: `${JSON.stringify(pkg, null, 2)}\n`,
  });

  const templateMap = [
    ...scaffoldTemplateMap(options.lang, options.styles),
    ...scaffoldPhpTemplateMap(options),
  ];

  for (const item of templateMap) {
    const raw = await readTemplate(item.template);
    files.push({
      relativePath: item.out,
      contents: applyTemplate(raw, vars),
    });
  }

  // Generated in code (not a template): npm drops dotfiles and dot folders
  // are easy to lose in the published package.
  files.push({ relativePath: CURSOR_RULE_PATH, contents: buildCursorRule(siteModules) });

  return files;
}

/**
 * List relative paths that block scaffolding: existing files, non-directory
 * intermediate segments, or any symlink on the path within the target dir.
 * Uses lstat so symlinks are never followed.
 *
 * @param {string} targetDir
 * @param {{ relativePath: string }[]} files
 * @param {{ lstat: (p: string) => Promise<import('node:fs').Stats> }} fs
 */
export async function findConflicts(targetDir, files, fs) {
  /** @type {string[]} */
  const conflicts = [];
  const seen = new Set();
  for (const file of files) {
    const parts = String(file.relativePath || '')
      .split(/[\\/]/)
      .filter(Boolean);
    let cur = targetDir;
    for (let i = 0; i < parts.length; i++) {
      cur = path.join(cur, parts[i]);
      const rel = parts.slice(0, i + 1).join('/');
      if (seen.has(rel)) {
        if (conflicts.includes(rel)) break;
        continue;
      }
      let st;
      try {
        st = await fs.lstat(cur);
      } catch (err) {
        if (err && /** @type {{ code?: string }} */ (err).code === 'ENOENT') break;
        throw err;
      }
      const isLast = i === parts.length - 1;
      if (st.isSymbolicLink()) {
        conflicts.push(rel);
        seen.add(rel);
        break;
      }
      if (isLast) {
        conflicts.push(rel);
        seen.add(rel);
        break;
      }
      if (!st.isDirectory()) {
        conflicts.push(rel);
        seen.add(rel);
        break;
      }
      seen.add(rel);
    }
  }
  return conflicts;
}

/**
 * Ensure targetDir and its ancestors are not files (and target is not a symlink).
 * @param {string} targetDir
 * @param {{ lstat: (p: string) => Promise<import('node:fs').Stats> }} fs
 * @returns {Promise<{ ok: true } | { ok: false, error: string }>}
 */
export async function assertScaffoldParentPath(targetDir, fs) {
  const resolved = path.resolve(targetDir);
  let cur = resolved;
  for (;;) {
    let st;
    try {
      st = await fs.lstat(cur);
    } catch (err) {
      const code = err && /** @type {{ code?: string }} */ (err).code;
      if (code === 'ENOENT' || code === 'ENOTDIR') {
        // Missing path, or an ancestor is a file (ENOTDIR when walking through it).
        if (code === 'ENOTDIR') {
          const parent = path.dirname(cur);
          return {
            ok: false,
            error: `Parent path is a file, not a directory: ${parent === cur ? cur : parent}`,
          };
        }
        const next = path.dirname(cur);
        if (next === cur) break;
        cur = next;
        continue;
      }
      throw err;
    }
    if (cur === resolved) {
      if (st.isSymbolicLink()) {
        return { ok: false, error: `Target path is a symlink: ${cur}` };
      }
      if (st.isFile()) {
        return { ok: false, error: `Target path is a file, not a directory: ${cur}` };
      }
      if (!st.isDirectory()) {
        return { ok: false, error: `Target path is not a directory: ${cur}` };
      }
    } else if (st.isFile()) {
      return { ok: false, error: `Parent path is a file, not a directory: ${cur}` };
    } else if (!st.isDirectory() && !st.isSymbolicLink()) {
      return { ok: false, error: `Parent path is not a directory: ${cur}` };
    }
    const next = path.dirname(cur);
    if (next === cur) break;
    cur = next;
  }
  return { ok: true };
}

/**
 * Remove paths created by this scaffold run (reverse order). Never touches
 * pre-existing files. When the target dir itself was created, remove it entirely.
 *
 * @param {string[]} created
 * @param {string | null} createdTargetDir
 * @param {{ remove: (p: string) => Promise<void> }} fs
 */
export async function rollbackScaffold(created, createdTargetDir, fs) {
  if (createdTargetDir) {
    try {
      await fs.remove(createdTargetDir);
    } catch {
      /* best effort */
    }
    return;
  }
  for (const p of [...created].reverse()) {
    try {
      await fs.remove(p);
    } catch {
      /* best effort */
    }
  }
}

/**
 * Create missing directories under targetRoot and record them for rollback.
 * @param {string} dir
 * @param {string} targetRoot
 * @param {string[]} created
 * @param {object} fs
 */
async function ensureDirTracked(dir, targetRoot, created, fs) {
  const resolved = path.resolve(dir);
  /** @type {string[]} */
  const missing = [];
  let cur = resolved;
  while (cur.startsWith(targetRoot + path.sep)) {
    try {
      await fs.lstat(cur);
      break;
    } catch (err) {
      if (!(err && /** @type {{ code?: string }} */ (err).code === 'ENOENT')) throw err;
      missing.push(cur);
    }
    const next = path.dirname(cur);
    if (next === cur) break;
    cur = next;
  }
  for (const p of missing.reverse()) {
    await fs.mkdir(p);
    created.push(p);
  }
}

/**
 * Write scaffold files with containment checks and rollback on failure.
 *
 * @param {string} targetDir
 * @param {{ relativePath: string, contents: string }[]} files
 * @param {object} fs fs-extra-like
 * @returns {Promise<{ ok: true, created: string[], createdTargetDir: string | null } | { ok: false, error: string, errorObj?: unknown }>}
 */
export async function writeScaffoldFiles(targetDir, files, fs) {
  const resolvedTarget = path.resolve(targetDir);
  /** @type {string[]} */
  const created = [];
  let createdTargetDir = /** @type {string | null} */ (null);
  let targetExisted = false;
  try {
    await fs.lstat(resolvedTarget);
    targetExisted = true;
  } catch (err) {
    if (!(err && /** @type {{ code?: string }} */ (err).code === 'ENOENT')) {
      return { ok: false, error: err instanceof Error ? err.message : String(err), errorObj: err };
    }
  }

  const fail = async (error, errorObj) => {
    await rollbackScaffold(created, createdTargetDir, fs);
    return { ok: false, error, errorObj };
  };

  try {
    if (!targetExisted) {
      await fs.ensureDir(resolvedTarget);
      createdTargetDir = resolvedTarget;
      created.push(resolvedTarget);
    }

    const realTarget = await fs.realpath(resolvedTarget);

    for (const file of files) {
      const abs = path.resolve(resolvedTarget, file.relativePath);
      const relToTarget = path.relative(resolvedTarget, abs);
      if (
        relToTarget.startsWith('..') ||
        path.isAbsolute(relToTarget) ||
        relToTarget.split(path.sep).includes('..')
      ) {
        return fail(`Refusing to write outside project directory: ${file.relativePath}`);
      }

      await ensureDirTracked(path.dirname(abs), resolvedTarget, created, fs);

      const realParent = await fs.realpath(path.dirname(abs));
      const realAbs = path.join(realParent, path.basename(abs));
      const relReal = path.relative(realTarget, realAbs);
      if (relReal.startsWith('..') || path.isAbsolute(relReal)) {
        return fail(`Refusing to write outside project directory: ${file.relativePath}`);
      }

      await fs.writeFile(abs, file.contents, 'utf8');
      created.push(abs);
    }

    return { ok: true, created, createdTargetDir };
  } catch (err) {
    return fail(err instanceof Error ? err.message : String(err), err);
  }
}
