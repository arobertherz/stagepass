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
 * Extra CLI arguments after the optional selection value are rejected (fail-closed).
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
 * Read one package version from the monorepo. Other package files are not read.
 * @param {string} dir
 * @param {string} [root]
 * @returns {{ dir: string, name: string, version: string }}
 */
export function readNamedPackage(dir, root = ROOT) {
  if (!PACKAGES.includes(dir)) {
    throw new Error(`Unknown package: ${dir}`);
  }
  const pkg = JSON.parse(
    readFileSync(join(root, 'packages', dir, 'package.json'), 'utf-8')
  );
  return { dir, name: pkg.name, version: pkg.version };
}

/**
 * Read package versions from the monorepo (helper for callers that need all three).
 * The selection path uses {@link readNamedPackage} instead.
 * @param {string} [root]
 * @returns {{ dir: string, name: string, version: string }[]}
 */
export function readPackageVersions(root = ROOT) {
  return PACKAGES.map((dir) => readNamedPackage(dir, root));
}

/**
 * Stage exactly the package named in the tag, if its version equals the tag.
 * Non-selected package files are not read, so `skip` is always empty.
 * @param {string} tag
 * @param {string} [root]
 * @returns {{ version: string, stage: { dir: string, name: string, version: string }[], skip: { dir: string, name: string, version: string }[] }}
 */
export function releasePlan(tag, root = ROOT) {
  const { dir, version } = parseReleaseTag(tag);
  const selected = readNamedPackage(dir, root);
  if (selected.version !== version) {
    throw new Error(
      `${selected.name}@${selected.version} does not match tag version ${version}`
    );
  }
  return {
    version,
    stage: [selected],
    skip: [],
  };
}

/**
 * npm dist-tag for staging. A prerelease (version contains `-`) stages on
 * `next`. A stable X.Y.Z stages on `latest`, so one approval publishes it
 * as the default install (see RELEASING.md).
 * @param {string} version
 * @returns {'next'|'latest'}
 */
export function distTagForVersion(version) {
  return version.includes('-') ? 'next' : 'latest';
}

function main() {
  if (process.argv.length > 3) {
    console.error('❌ Extra arguments are not allowed');
    process.exit(1);
  }
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
  const kind = plan.version.includes('-') ? 'prerelease' : 'stable';
  const selected = plan.stage[0];
  console.log(`✅ Stage ${selected.name}@${selected.version}`);
  console.log(`   dist_tag: ${distTag} (${kind})`);

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
