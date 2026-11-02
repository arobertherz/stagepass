/**
 * Versions of @stagepass/loader and @stagepass/modules this CLI targets.
 *
 * Values come from the generated `package-versions.js` (run
 * `node scripts/sync-cli-versions.mjs`). Used for docs and snippet examples.
 * Dependency ranges never come from the CLI version: new projects use the
 * major range (`^2`) and `stagepass upgrade` only writes ranges a published
 * version satisfies. A drift test keeps the generated file in sync with
 * packages/loader and packages/modules.
 */

import { LOADER_VERSION, MODULES_VERSION } from './package-versions.js';

export { LOADER_VERSION, MODULES_VERSION };

/**
 * @deprecated Prefer `LOADER_VERSION` for loader snippets / pins /
 * `data-stagepass-version`, and `MODULES_VERSION` where modules are meant.
 * Kept as an alias of `LOADER_VERSION` for older call sites and tests.
 */
export const STAGEPASS_PACKAGES_VERSION = LOADER_VERSION;

/**
 * Major caret range for a version (e.g. 2.3.1 → ^2), matching the `@2` CDN
 * embed policy. Generated projects use it so `npm install` works with
 * whatever 2.x is published; staged but unpublished releases never break it.
 *
 * @param {string} [version]
 * @returns {string}
 */
export function packagesRange(version = LOADER_VERSION) {
  const match = /^[~^]?(\d+)(?:\.\d+){0,2}$/.exec(String(version).trim());
  if (!match) {
    throw new Error(`Invalid @stagepass package version: ${version}`);
  }
  return `^${match[1]}`;
}
