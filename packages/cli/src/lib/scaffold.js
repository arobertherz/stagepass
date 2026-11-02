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
 * Extra files when PHP is enabled for the project.
 * @param {{ php?: boolean, phpExamples?: boolean }} options
 * @returns {{ template: string, out: string }[]}
 */
export function scaffoldPhpTemplateMap(options = {}) {
  if (options.php !== true) return [];
  /** @type {{ template: string, out: string }[]} */
  const files = [{ template: 'api/README.md.tmpl', out: 'api/README.md' }];
  if (options.phpExamples === true) {
    files.push(
      { template: 'examples/php/form.php', out: 'examples/php/form.php' },
      { template: 'examples/php/proxy.php', out: 'examples/php/proxy.php' },
      { template: 'examples/php/README.md.tmpl', out: 'examples/php/README.md' }
    );
  }
  return files;
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
 * @property {boolean} [phpExamples] Include examples/php samples (requires php)
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
          'This project enables PHP for the linked `.sp` site (`php_fastcgi`). Put handlers under `api/`.',
          options.phpExamples
            ? 'Optional samples live in `examples/php/` (copy or adapt; do not expose secrets).'
            : 'Optional samples: re-run scaffolding with `--php --php-examples`, or copy from the Stagepass docs.',
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
 * List relative paths that already exist and would be overwritten.
 * @param {string} targetDir
 * @param {{ relativePath: string }[]} files
 * @param {{ pathExists: (p: string) => Promise<boolean> }} fs
 */
export async function findConflicts(targetDir, files, fs) {
  /** @type {string[]} */
  const conflicts = [];
  for (const file of files) {
    const abs = path.join(targetDir, file.relativePath);
    if (await fs.pathExists(abs)) {
      conflicts.push(file.relativePath);
    }
  }
  return conflicts;
}
