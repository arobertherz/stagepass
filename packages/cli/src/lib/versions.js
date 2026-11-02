/**
 * Version of @stagepass/loader and @stagepass/modules this CLI targets.
 *
 * Used for docs and snippet examples only. Dependency ranges never come from
 * this or the CLI version: new projects use the major range (`^2`) and
 * `stagepass upgrade` only writes ranges a published version satisfies.
 * A monorepo test keeps this in sync with packages/loader and packages/modules.
 */
export const STAGEPASS_PACKAGES_VERSION = '2.2.0';

/**
 * Major caret range for a version (e.g. 2.2.0 → ^2), matching the `@2` CDN
 * embed policy. Generated projects use it so `npm install` works with
 * whatever 2.x is published; staged but unpublished releases never break it.
 *
 * @param {string} [version]
 * @returns {string}
 */
export function packagesRange(version = STAGEPASS_PACKAGES_VERSION) {
  const match = /^[~^]?(\d+)(?:\.\d+){0,2}$/.exec(String(version).trim());
  if (!match) {
    throw new Error(`Invalid @stagepass package version: ${version}`);
  }
  return `^${match[1]}`;
}
