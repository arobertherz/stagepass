import { normalizeModulesList } from './project-modules.js';
import { STAGEPASS_PACKAGES_VERSION } from './versions.js';

/**
 * Safe token for CDN pins and data-stagepass-version (blocks HTML/attr injection).
 * @param {unknown} version
 * @returns {string}
 */
export function sanitizeSnippetVersion(version) {
  const value = String(version == null ? '' : version).trim();
  // Allow optional ^/~ range prefixes used in package.json; reject quotes and HTML.
  if (!/^[~^]?[0-9A-Za-z][0-9A-Za-z._+-]*$/.test(value)) {
    throw new Error(
      'Invalid version for Webflow snippets (use a semver or npm dist-tag).'
    );
  }
  return value;
}

/**
 * Build recommended Webflow Custom Code snippets (jsDelivr major pin @2).
 *
 * @param {object} options
 * @param {string} options.version Exact package version for data-stagepass-version / docs
 * @param {boolean} [options.modules] Legacy: true = inject + cookies tags
 * @param {string[]} [options.moduleList] Declared modules (wins over `modules`)
 * @returns {{ head: string, footer: string, majorPin: string, exactPin: string }}
 */
export function buildWebflowSnippets(options) {
  const version = sanitizeSnippetVersion(options.version || STAGEPASS_PACKAGES_VERSION);
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

  const loaderLines = [
    '<!-- Stagepass loader (major pin @2; optional exact pin shown in data-stagepass-version) -->',
    '<script',
    `  src="https://cdn.jsdelivr.net/npm/@stagepass/loader${majorPin}/dist/loader.min.js"`,
    `  data-stagepass-version="${version}"`,
    '></script>',
  ];

  for (const id of moduleFiles) {
    loaderLines.push(
      `<script src="https://cdn.jsdelivr.net/npm/@stagepass/modules${majorPin}/dist/${id}.min.js"></script>`
    );
  }

  const footerLines = [
    '<!-- Project assets: production URLs in data-src / data-href; local paths for Stagepass -->',
    '<!-- After `npm run build`, check dist/manifest.json for content-hashed filenames. -->',
    '<script',
    '  data-src="https://cdn.example.com/js/main.js"',
    '  data-stagepass="true"',
    '  data-stagepass-path="dist/main.js"',
    '></script>',
    '<link',
    '  rel="stylesheet"',
    '  data-href="https://cdn.example.com/css/styles.css"',
    '  data-stagepass="true"',
    '  data-stagepass-path="dist/styles.css"',
    '>',
  ];

  return {
    head: loaderLines.join('\n'),
    footer: footerLines.join('\n'),
    majorPin,
    exactPin,
  };
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
  log(
    `\nOptional exact pin example (instead of @2): replace @2 with the exact version (e.g. @${STAGEPASS_PACKAGES_VERSION}).`
  );
}
