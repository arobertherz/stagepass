/** Official loader/modules CDN base. Active host is jsDelivr, not cdn.stagepass.one. */
export const STAGEPASS_PACKAGE_CDN = 'https://cdn.jsdelivr.net/npm';

/**
 * @param {string} name Package short name (`loader` or `modules`)
 * @param {string} pin CDN pin including `@` (for example `@2`)
 * @param {string} file File under `dist/`
 * @returns {string}
 */
export function stagepassPackageUrl(name, pin, file) {
  return `${STAGEPASS_PACKAGE_CDN}/@stagepass/${name}${pin}/dist/${file}`;
}
