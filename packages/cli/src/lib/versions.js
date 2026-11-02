/**
 * Version of @stagepass/loader and @stagepass/modules this CLI targets.
 *
 * The CLI can ship patch releases on its own (e.g. cli 2.1.1 while loader and
 * modules stay at 2.1.0), so generated projects and `stagepass upgrade` must
 * not reuse the CLI version. A monorepo test keeps this in sync with
 * packages/loader and packages/modules.
 */
export const STAGEPASS_PACKAGES_VERSION = '2.1.0';

/**
 * Caret range on the major of a version (e.g. 2.1.0 → ^2.0.0).
 * Matches the documented CDN default `@2` (strict semver within a major).
 *
 * @param {string} [version]
 * @returns {string}
 */
export function packagesRange(version = STAGEPASS_PACKAGES_VERSION) {
  const match = /^[~^]?(\d+)\./.exec(String(version).trim());
  if (!match) {
    throw new Error(`Invalid @stagepass package version: ${version}`);
  }
  return `^${match[1]}.0.0`;
}
