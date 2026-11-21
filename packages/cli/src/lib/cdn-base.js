/**
 * Official loader/modules CDN.
 *
 * Default host is https://cdn.stagepass.one: exact pins, full file path,
 * no `/dist/` segment. jsDelivr remains an alternative (npm package paths,
 * often a major pin, `/dist/` segment). Do not recommend unpkg.
 */
export const STAGEPASS_CDN_ORIGIN = 'https://cdn.stagepass.one';
export const STAGEPASS_JSDELIVR_CDN = 'https://cdn.jsdelivr.net/npm';
/** Default package CDN origin (Stagepass CDN). Prefer stagepassPackageUrl(). */
export const STAGEPASS_PACKAGE_CDN = STAGEPASS_CDN_ORIGIN;

/**
 * Published npm versions for snippet exact pins (loader `latest`, modules `latest`).
 * Literals only: not read from the CLI package version, and not copied
 * automatically when the monorepo is ahead of npm.
 */
export const SNIPPET_LOADER_VERSION = '2.5.0';
export const SNIPPET_MODULES_VERSION = '2.2.2';
export const SNIPPET_MAJOR_PIN = '@2';

/**
 * @param {unknown} raw
 * @returns {'stagepass' | 'jsdelivr' | null}
 */
export function normalizeCdnChoice(raw) {
  const v = String(raw == null ? '' : raw).trim().toLowerCase();
  if (
    v === '' ||
    v === 'stagepass' ||
    v === 'cdn.stagepass.one' ||
    v === 'stagepass.one'
  ) {
    return 'stagepass';
  }
  if (
    v === 'jsdelivr' ||
    v === 'jsdelivr.net' ||
    v === 'cdn.jsdelivr.net' ||
    v === 'cdn.jsdelivr.net/npm'
  ) {
    return 'jsdelivr';
  }
  return null;
}

/**
 * Pins used in generated Webflow snippets for a CDN host.
 * Stagepass CDN uses exact pins; jsDelivr keeps the major pin `@2`.
 * @param {unknown} [cdn]
 * @returns {{ cdn: 'stagepass' | 'jsdelivr', loaderPin: string, modulesPin: string }}
 */
export function defaultSnippetPins(cdn) {
  const host = normalizeCdnChoice(cdn) || 'stagepass';
  if (host === 'jsdelivr') {
    return {
      cdn: host,
      loaderPin: SNIPPET_MAJOR_PIN,
      modulesPin: SNIPPET_MAJOR_PIN,
    };
  }
  return {
    cdn: host,
    loaderPin: `@${SNIPPET_LOADER_VERSION}`,
    modulesPin: `@${SNIPPET_MODULES_VERSION}`,
  };
}

/**
 * @param {string} name Package short name (`loader` or `modules`)
 * @param {string} pin CDN pin including `@` (for example `@2` or `@2.5.0`)
 * @param {string} file File under the host path (`loader.min.js`)
 * @param {{ cdn?: string }} [options]
 * @returns {string}
 */
export function stagepassPackageUrl(name, pin, file, options = {}) {
  const cdn = normalizeCdnChoice(options.cdn) || 'stagepass';
  if (cdn === 'jsdelivr') {
    return `${STAGEPASS_JSDELIVR_CDN}/@stagepass/${name}${pin}/dist/${file}`;
  }
  return `${STAGEPASS_CDN_ORIGIN}/${name}${pin}/${file}`;
}
