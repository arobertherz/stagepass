import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'module';
import { buildWebflowSnippets } from './snippets.js';

const require = createRequire(import.meta.url);
const { version: cliVersion } = require('../../package.json');

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/** Absolute path to packaged templates/project */
export function defaultTemplatesRoot() {
  return path.join(__dirname, '../../templates/project');
}

/**
 * @typedef {object} ScaffoldOptions
 * @property {string} name
 * @property {string} dir Absolute or relative target directory
 * @property {string} [author]
 * @property {'ts'|'js'} lang
 * @property {'scss'|'css'} styles
 * @property {boolean} modules
 * @property {boolean} git
 * @property {string} [remote]
 * @property {boolean} install
 * @property {boolean} dryRun
 * @property {string} [loaderVersion]
 */

/**
 * @param {ScaffoldOptions} options
 * @returns {Record<string, string>}
 */
export function buildPackageJson(options) {
  const version = options.loaderVersion || cliVersion;
  const isTs = options.lang === 'ts';
  const useSass = options.styles === 'scss';

  /** @type {Record<string, string>} */
  const devDependencies = {
    '@stagepass/loader': version,
    esbuild: '^0.25.0',
  };

  if (options.modules) {
    devDependencies['@stagepass/modules'] = version;
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
 * Plan files to write for a scaffold (relative paths → contents).
 * @param {ScaffoldOptions} options
 * @param {object} [deps]
 * @param {(rel: string) => Promise<string>} [deps.readTemplate]
 * @returns {Promise<{ relativePath: string, contents: string }[]>}
 */
export async function planScaffoldFiles(options, deps = {}) {
  const version = options.loaderVersion || cliVersion;
  const isTs = options.lang === 'ts';
  const useSass = options.styles === 'scss';
  const entryJs = isTs ? 'src/main.ts' : 'src/main.js';
  const entryCss = useSass ? 'src/styles.scss' : 'src/styles.css';
  const configFile = isTs ? 'tsconfig.json' : 'jsconfig.json';

  const snippets = buildWebflowSnippets({
    version,
    modules: options.modules,
  });

  const vars = {
    NAME: options.name,
    AUTHOR: options.author || '',
    LANG: options.lang,
    STYLES: options.styles,
    MODULES_JSON: options.modules ? 'true' : 'false',
    LOADER_VERSION: version,
    HEAD_SNIPPET: snippets.head,
    FOOTER_SNIPPET: snippets.footer,
    ENTRY_JS: entryJs,
    ENTRY_CSS: entryCss,
    USE_SASS: useSass ? 'true' : 'false',
    CONFIG_FILE: configFile,
    MODULES_NOTE: options.modules
      ? '\nModules are enabled: load `inject` / `cookies` (or `all`) after the loader in Webflow Head.\n'
      : '\nModules are not included. Add `@stagepass/modules` later if you need `sp.inject` or `sp.cookies`.\n',
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
    { template: 'scripts/build.mjs', out: 'scripts/build.mjs' },
    { template: '.gitignore', out: '.gitignore' },
    { template: 'README.md.tmpl', out: 'README.md' },
    { template: 'AGENTS.md.tmpl', out: 'AGENTS.md' },
    { template: 'stagepass.json.tmpl', out: 'stagepass.json' },
    {
      template: isTs ? 'src/main.ts.tmpl' : 'src/main.js.tmpl',
      out: entryJs,
    },
    {
      template: useSass ? 'src/styles.scss.tmpl' : 'src/styles.css.tmpl',
      out: entryCss,
    },
    {
      template: isTs ? 'tsconfig.json.tmpl' : 'jsconfig.json.tmpl',
      out: configFile,
    },
  ];

  for (const item of templateMap) {
    const raw = await readTemplate(item.template);
    files.push({
      relativePath: item.out,
      contents: applyTemplate(raw, vars),
    });
  }

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
