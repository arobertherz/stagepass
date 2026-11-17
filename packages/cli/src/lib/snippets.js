import { execFile as nodeExecFile } from 'node:child_process';
import { promisify } from 'node:util';
import {
  SNIPPET_LOADER_VERSION,
  SNIPPET_MODULES_VERSION,
  stagepassPackageUrl,
} from './cdn-base.js';
import { validateProjectName } from './project-name.js';
import { expandModules, normalizeModulesList } from './project-modules.js';

const execFileAsync = promisify(nodeExecFile);

/** Same body as snippet versions, without the optional ^/~ range prefix. */
const SNIPPET_TOKEN_BODY = '[0-9A-Za-z][0-9A-Za-z._+-]*';
const SNIPPET_VERSION_RE = new RegExp(`^[~^]?${SNIPPET_TOKEN_BODY}$`);
const SNIPPET_TOKEN_RE = new RegExp(`^${SNIPPET_TOKEN_BODY}$`);

const GITHUB_HTTPS_RE =
  /^https?:\/\/(?:www\.)?github\.com(?::\d+)?\/([^/?#\s]+)\/([^/?#\s]+?)(?:\.git)?\/?(?:[?#].*)?$/i;
const GITHUB_SSH_URL_RE =
  /^ssh:\/\/(?:git@)?github\.com(?::\d+)?\/([^/?#\s]+)\/([^/?#\s]+?)(?:\.git)?\/?$/i;
const GITHUB_SCP_RE = /^git@github\.com:([^/\s]+)\/([^/\s]+?)(?:\.git)?$/i;

/**
 * Safe token for CDN pins and data-stagepass-version (blocks HTML/attr injection).
 * @param {unknown} version
 * @returns {string}
 */
export function sanitizeSnippetVersion(version) {
  const value = String(version == null ? '' : version).trim();
  if (!SNIPPET_VERSION_RE.test(value)) {
    throw new Error(
      'Invalid version for Webflow snippets (use a semver or npm dist-tag).'
    );
  }
  return value;
}

/**
 * Owner/repo token. Same character rules as {@link sanitizeSnippetVersion}.
 * @param {unknown} value
 * @returns {string}
 */
export function sanitizeSnippetToken(value) {
  const token = String(value == null ? '' : value).trim();
  if (!SNIPPET_TOKEN_RE.test(token)) {
    throw new Error(
      'Invalid name for Webflow snippets (owner and repo must be plain tokens).'
    );
  }
  return token;
}

/**
 * @param {unknown} remote
 * @returns {{ owner: string, repo: string } | null}
 */
function parseGitHubRemote(remote) {
  const value = String(remote == null ? '' : remote).trim();
  if (!value) return null;

  const match =
    GITHUB_HTTPS_RE.exec(value) ||
    GITHUB_SSH_URL_RE.exec(value) ||
    GITHUB_SCP_RE.exec(value);
  const githubShaped =
    /^(?:https?:\/\/(?:www\.)?github\.com(?::\d+)?(?:\/|$)|ssh:\/\/(?:git@)?github\.com(?::\d+)?(?:\/|$)|git@github\.com:)/i.test(
      value
    );
  if (!match) {
    if (githubShaped && /[<>"'`\\\s]/.test(value)) {
      throw new Error(
        'Invalid name for Webflow snippets (owner and repo must be plain tokens).'
      );
    }
    return null;
  }

  let owner = match[1];
  let repo = match[2];
  try {
    owner = decodeURIComponent(owner);
    repo = decodeURIComponent(repo);
  } catch {
    throw new Error(
      'Invalid name for Webflow snippets (owner and repo must be plain tokens).'
    );
  }
  return {
    owner: sanitizeSnippetToken(owner),
    repo: sanitizeSnippetToken(repo),
  };
}

// Missing or unsafe branch names fall back to main (slashes are allowed).
function safeBranch(branch) {
  const value = String(branch == null ? '' : branch).trim();
  if (!value || value === 'HEAD') return 'main';
  if (!/^[0-9A-Za-z][0-9A-Za-z._+/-]*$/.test(value)) return 'main';
  if (value.includes('..') || value.includes('//') || value.endsWith('/')) return 'main';
  return value;
}

/**
 * @param {object} [options]
 * @param {unknown} [options.gitRemote]
 * @param {unknown} [options.gitBranch]
 * @param {unknown} [options.projectName]
 */
function describeProjectAssets(options = {}) {
  const parsed = parseGitHubRemote(options.gitRemote);
  if (!parsed) {
    const name = validateProjectName(options.projectName);
    const segment = name.ok ? name.name : 'project';
    return {
      kind: 'placeholder',
      js: 'https://YOUR-PRODUCTION-URL/js/main.js',
      css: 'https://YOUR-PRODUCTION-URL/css/styles.css',
      exampleJs: `https://YOUR-PRODUCTION-URL/${segment}/main.a1b2c3d4.js`,
      hint: 'Replace YOUR-PRODUCTION-URL with the host that serves your production assets.',
    };
  }
  const branch = safeBranch(options.gitBranch);
  const base = `https://cdn.jsdelivr.net/gh/${parsed.owner}/${parsed.repo}@${branch}`;
  return {
    kind: 'github',
    js: `${base}/dist/main.js`,
    css: `${base}/dist/styles.css`,
    exampleJs: `${base}/dist/main.a1b2c3d4.js`,
    hint: 'jsDelivr only serves public repos. A tag is a better production pin than a branch. After npm run build, commit the dist folder, or check dist/manifest.json for hashed file names.',
  };
}

/**
 * @param {{ kind: string, js: string, css: string }} assets
 * @returns {string}
 */
function footerFor(assets) {
  const notes =
    assets.kind === 'github'
      ? [
          '<!-- jsDelivr only serves public repos. A tag is a better production pin than a branch. -->',
          '<!-- After `npm run build`, commit the dist folder, or check dist/manifest.json for hashed file names. -->',
        ]
      : [
          '<!-- Replace YOUR-PRODUCTION-URL with the host that serves your production assets. -->',
          '<!-- After `npm run build`, check dist/manifest.json for hashed file names. -->',
        ];
  return [
    ...notes,
    '<script',
    `  data-src="${assets.js}"`,
    '  data-stagepass="true"',
    '  data-stagepass-path="dist/main.js"',
    '></script>',
    '<link',
    '  rel="stylesheet"',
    `  data-href="${assets.css}"`,
    '  data-stagepass="true"',
    '  data-stagepass-path="dist/styles.css"',
    '>',
  ].join('\n');
}

/**
 * Build recommended Webflow Custom Code snippets (major pin @2).
 *
 * @param {object} options
 * @param {string} options.version Exact package version for data-stagepass-version / docs
 * @param {boolean} [options.modules] Legacy: true = inject + cookies tags
 * @param {string[]} [options.moduleList] Declared modules (wins over `modules`)
 * @param {string} [options.gitRemote] `origin` URL. GitHub https/ssh becomes a jsDelivr `/gh/` URL.
 * @param {string} [options.gitBranch] Current branch. Missing or unsafe values use `main`.
 * @param {string} [options.projectName] Used in the README placeholder example path.
 * @returns {{ head: string, footer: string, majorPin: string, exactPin: string, assetExampleUrl: string, assetHint: string }}
 */
export function buildWebflowSnippets(options) {
  const version = sanitizeSnippetVersion(options.version || SNIPPET_LOADER_VERSION);
  /** @type {string[]} */
  let moduleFiles = [];
  if (Array.isArray(options.moduleList)) {
    const parsed = normalizeModulesList(options.moduleList);
    if (!parsed.ok) throw new Error(parsed.error);
    moduleFiles = parsed.modules;
  } else if (options.modules === true) {
    moduleFiles = ['inject', 'cookies'];
  }
  const majorPin = '@2';
  const exactPin = `@${version}`;
  const assets = describeProjectAssets(options);

  const loaderLines = [
    '<!-- Stagepass loader (major pin @2; optional exact pin shown in data-stagepass-version) -->',
    '<script',
    `  src="${stagepassPackageUrl('loader', majorPin, 'loader.min.js')}"`,
    `  data-stagepass-version="${version}"`,
    '></script>',
  ];

  for (const id of moduleFiles) {
    loaderLines.push(
      `<script src="${stagepassPackageUrl('modules', majorPin, `${id}.min.js`)}"></script>`
    );
  }

  return {
    head: loaderLines.join('\n'),
    footer: footerFor(assets),
    majorPin,
    exactPin,
    assetExampleUrl: assets.exampleJs,
    assetHint: assets.hint,
  };
}

/**
 * Head snippet for the loader and the declared modules. Used by `stagepass start`.
 * `all` expands to inject, cookies, maintenance, in that order. An empty list is the loader only.
 * @param {object} [options]
 * @param {string} [options.version]
 * @param {string[]} [options.moduleList] Declared modules (`[]` when none)
 */
export function buildOfficialHeadSnippets(options = {}) {
  const raw = Array.isArray(options.moduleList) ? options.moduleList : [];
  const parsed = normalizeModulesList(raw);
  if (!parsed.ok) throw new Error(parsed.error);
  return buildWebflowSnippets({
    version: options.version,
    moduleList: expandModules(parsed.modules),
  });
}

/**
 * `origin` URL and current branch for footer asset URLs. Empty remote if git is missing.
 * @param {string} cwd
 * @param {import('./exec.js').ExecFn} [exec]
 * @returns {Promise<{ gitRemote: string, gitBranch: string }>}
 */
export async function readSnippetGitRef(cwd, exec) {
  const gitRemote = await gitText(cwd, ['remote', 'get-url', 'origin'], exec);
  // symbolic-ref and branch --show-current still work on an unborn branch
  // (no commits yet). rev-parse --abbrev-ref HEAD does not.
  let gitBranch = await gitText(cwd, ['symbolic-ref', '--short', 'HEAD'], exec);
  if (!gitBranch) gitBranch = await gitText(cwd, ['branch', '--show-current'], exec);
  if (!gitBranch || gitBranch === 'HEAD') gitBranch = 'main';
  return { gitRemote, gitBranch };
}

/**
 * @param {string} cwd
 * @param {string[]} args
 * @param {import('./exec.js').ExecFn} [exec]
 * @returns {Promise<string>}
 */
async function gitText(cwd, args, exec) {
  try {
    const result = exec
      ? await exec('git', args, { cwd })
      : await execFileAsync('git', args, {
          cwd,
          encoding: 'utf8',
          timeout: 5000,
          maxBuffer: 64 * 1024,
        });
    return String(result?.stdout || '').trim();
  } catch {
    return '';
  }
}

function logExactPin(log, snippets) {
  const loader = String(snippets?.exactPin || '').replace(/^@/, '') || SNIPPET_LOADER_VERSION;
  log(
    `\nOptional exact pin example (instead of @2): loader @${loader}, modules @${SNIPPET_MODULES_VERSION}.`
  );
}

/**
 * Print the loader/modules head snippet.
 * @param {{ head: string }} snippets
 * @param {(msg: string) => void} [log]
 */
export function printWebflowHeadSnippets(snippets, log = console.log) {
  log('\nWebflow Custom Code (Head):');
  log(snippets.head);
  logExactPin(log, snippets);
}

/**
 * Print head/footer snippets with section labels.
 * @param {{ head: string, footer: string }} snippets
 * @param {(msg: string) => void} [log]
 */
export function printWebflowSnippets(snippets, log = console.log) {
  log('\nWebflow Custom Code (Head):');
  log(snippets.head);
  log('\nWebflow Custom Code (Footer):');
  log(snippets.footer);
  logExactPin(log, snippets);
}
