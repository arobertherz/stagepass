import { normalizeModulesList } from './project-modules.js';
import { STAGEPASS_PACKAGES_VERSION } from './versions.js';

/**
 * Safe token for CDN pins and data-stagepass-version (blocks HTML/attr injection).
 * @param {unknown} version
 * @returns {string}
 */
export function sanitizeSnippetVersion(version) {
  const value = String(version == null ? '' : version).trim();
  // Exact stable X.Y.Z only (no prerelease, build metadata, or ranges).
  if (!/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(value)) {
    throw new Error(
      'Invalid version for Webflow snippets (use a stable X.Y.Z semver).'
    );
  }
  return value;
}

/**
 * @param {object} options
 * @param {string} options.version
 * @param {boolean} [options.modules]
 * @param {string[]} [options.moduleList]
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
 * @param {{ head: string, footer: string, exactPin?: string }} snippets
 * @param {(msg: string) => void} [log]
 */
export function printWebflowSnippets(snippets, log = console.log) {
  log('\nWebflow Custom Code (Head):');
  log(snippets.head);
  log('\nWebflow Custom Code (Footer):');
  log(snippets.footer);
  log(
    `\nOptional exact pin example (instead of @2): replace @2 with the exact version (e.g. ${snippets.exactPin || `@${STAGEPASS_PACKAGES_VERSION}`}).`
  );
}
