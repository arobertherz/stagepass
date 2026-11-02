/**
 * Version of @stagepass/loader and @stagepass/modules this CLI targets.
 *
 * The CLI can ship patch releases on its own (e.g. cli 2.2.1 while loader and
 * modules stay at 2.2.0), so generated projects and `stagepass upgrade` must
 * not reuse the CLI version. A monorepo test keeps this in sync with
 * packages/loader and packages/modules.
 */
export const STAGEPASS_PACKAGES_VERSION = '2.2.0';

/**
 * Caret range from the major.minor of a version (e.g. 2.2.0 → ^2.2.0).
 * Stays within the major (CDN default `@2`) but requires the minor that
 * ships the features generated projects rely on (per-module types in 2.2).
 * npm resolves it once published, even while the release only carries the
 * `next` dist-tag (latest 2.0.0 does not satisfy it).
 *
 * @param {string} [version]
 * @returns {string}
 */
export function packagesRange(version = STAGEPASS_PACKAGES_VERSION) {
  const match = /^[~^]?(\d+)\.(\d+)\./.exec(String(version).trim());
  if (!match) {
    throw new Error(`Invalid @stagepass package version: ${version}`);
  }
  return `^${match[1]}.${match[2]}.0`;
}
