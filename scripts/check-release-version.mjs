#!/usr/bin/env node
/**
 * Verify a package-specific release tag and decide which one package to stage.
 *
 * Tags look like `modules-v2.2.2`, `loader-v2.3.3`, or `cli-v2.2.6`
 * (same shape as workflow_dispatch input `ref`). A shared `v*` tag is not a
 * release tag and stages nothing.
 *
 * Usage:
 *   node scripts/check-release-version.mjs modules-v2.2.2
 *   node scripts/check-release-version.mjs loader-v2.3.3
 *   RELEASE_REF=cli-v2.2.6 node scripts/check-release-version.mjs  # omitted arg only; empty does not fall back
 *
 * Exit 0 when the named package version equals the tag version, 1 otherwise.
 */

import { appendFileSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PACKAGES = ['cli', 'loader', 'modules'];
const RELEASE_TAG = /^(cli|loader|modules)-v([0-9]+\.[0-9]+\.[0-9]+(?:-[a-z0-9.]+)?)$/;

/**
 * Parse `cli-vX`, `loader-vX`, or `modules-vX`. Shared `v*` tags fail closed.
 * @param {string} tag
 * @returns {{ dir: string, version: string }}
 */
export function parseReleaseTag(tag) {
  if (typeof tag !== 'string' || !tag) {
    throw new Error('Tag/version argument is required');
  }
  const match = RELEASE_TAG.exec(tag);
  if (!match) {
    throw new Error(`Not a package release tag: ${tag}`);
  }
  return { dir: match[1], version: match[2] };
}

/**
 * Read package versions from the monorepo.
 * @param {string} [root]
 * @returns {{ dir: string, name: string, version: string }[]}
 */
export function readPackageVersions(root = ROOT) {
  return PACKAGES.map((dir) => {
    const pkg = JSON.parse(
      readFileSync(join(root, 'packages', dir, 'package.json'), 'utf-8')
    );
    return { dir, name: pkg.name, version: pkg.version };
  });
}

/**
 * Stage exactly the package named in the tag, if its version equals the tag.
 * @param {string} tag
 * @param {string} [root]
 * @returns {{ version: string, stage: { dir: string, name: string, version: string }[], skip: { dir: string, name: string, version: string }[] }}
 */
export function releasePlan(tag, root = ROOT) {
  const { dir, version } = parseReleaseTag(tag);
  const packages = readPackageVersions(root);
  const selected = packages.find((pkg) => pkg.dir === dir);
  if (!selected) {
    throw new Error(`Unknown package: ${dir}`);
  }
  if (selected.version !== version) {
    throw new Error(
      `${selected.name}@${selected.version} does not match tag version ${version}`
    );
  }
  return {
    version,
    stage: [selected],
    skip: packages.filter((pkg) => pkg.dir !== dir),
  };
}

/**
 * npm dist-tag for staging. Every staged release (stable or prerelease) goes
 * to `next`; promoting a verified stable release to `latest` is a separate,
 * explicit `npm dist-tag add` step (see RELEASING.md). This keeps existing
 * `npm install` / `^2` users on the current latest until the release is checked.
 * @param {string} _version
 * @returns {'next'}
 */
export function distTagForVersion(_version) {
  return 'next';
}

function main() {
  const arg = process.argv[2] ?? process.env.RELEASE_REF ?? process.env.GITHUB_REF_NAME ?? '';
  let plan;
  try {
    plan = releasePlan(arg);
  } catch (e) {
    console.error(`❌ ${e.message || e}`);
    process.exit(1);
  }

  if (plan.stage.length !== 1) {
    console.error(`❌ Tag version ${plan.version} did not select exactly one package`);
    process.exit(1);
  }

  const distTag = distTagForVersion(plan.version);
  const kind = plan.version.includes('-') ? 'prerelease' : 'stable; promote after verification';
  const selected = plan.stage[0];
  console.log(`✅ Stage ${selected.name}@${selected.version}`);
  for (const pkg of plan.skip) console.log(`   skip  ${pkg.name}@${pkg.version}`);
  console.log(`   npm dist-tag: ${distTag} (${kind})`);

  if (process.env.GITHUB_OUTPUT) {
    appendFileSync(
      process.env.GITHUB_OUTPUT,
      `stage_dir=${selected.dir}\ndist_tag=${distTag}\n`
    );
  }
}

const isDirect =
  process.argv[1] &&
  fileURLToPath(import.meta.url) === process.argv[1];

if (isDirect) {
  main();
}
