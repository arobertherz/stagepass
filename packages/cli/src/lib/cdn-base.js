/** Official loader/modules CDN base. Active host is jsDelivr, not cdn.stagepass.one. */
export const STAGEPASS_PACKAGE_CDN = 'https://cdn.jsdelivr.net/npm';

/**
 * Published npm versions for snippet exact pins (loader `latest`, modules `latest`).
 * Literals only: not read from the CLI package version, and not copied
 * automatically when the monorepo is ahead of npm.
 */
export const SNIPPET_LOADER_VERSION = '2.5.0';
export const SNIPPET_MODULES_VERSION = '2.2.2';

/**
 * @param {string} name Package short name (`loader` or `modules`)
 * @param {string} pin CDN pin including `@` (for example `@2`)
 * @param {string} file File under `dist/`
 * @returns {string}
 */
export function stagepassPackageUrl(name, pin, file) {
  return `${STAGEPASS_PACKAGE_CDN}/@stagepass/${name}${pin}/dist/${file}`;
}
