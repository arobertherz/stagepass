#!/usr/bin/env node
/**
 * Verify that a git tag (with or without leading `v`) matches the version
 * field of every Stagepass package.json.
 *
 * Usage:
 *   node scripts/check-release-version.mjs v2.0.0-beta.1
 *   node scripts/check-release-version.mjs 2.0.0-beta.1
 *   GITHUB_REF_NAME=v2.0.0-beta.1 node scripts/check-release-version.mjs
 *
 * Exit 0 on match, 1 otherwise.
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PACKAGES = ['cli', 'loader', 'modules'];

/**
 * Strip a leading `v` from a tag name.
 * @param {string} tag
 * @returns {string}
 */
export function normalizeTagVersion(tag) {
  if (typeof tag !== 'string' || !tag.trim()) {
    throw new Error('Tag/version argument is required');
  }
  const trimmed = tag.trim();
  return trimmed.startsWith('v') ? trimmed.slice(1) : trimmed;
}

/**
 * Read package versions from the monorepo.
 * @param {string} [root]
 * @returns {{ name: string, version: string }[]}
 */
export function readPackageVersions(root = ROOT) {
  return PACKAGES.map((dir) => {
    const pkg = JSON.parse(
      readFileSync(join(root, 'packages', dir, 'package.json'), 'utf-8')
    );
    return { name: pkg.name, version: pkg.version };
  });
}

/**
 * @param {string} tag
 * @param {string} [root]
 * @returns {{ ok: true, version: string } | { ok: false, version: string, mismatches: { name: string, version: string }[] }}
 */
export function checkReleaseVersion(tag, root = ROOT) {
  const version = normalizeTagVersion(tag);
  const packages = readPackageVersions(root);
  const mismatches = packages.filter((p) => p.version !== version);
  if (mismatches.length > 0) {
    return { ok: false, version, mismatches };
  }
  return { ok: true, version };
}

/**
 * Choose npm dist-tag from a semver string (prerelease → next, else latest).
 * @param {string} version
 * @returns {'next' | 'latest'}
 */
export function distTagForVersion(version) {
  return version.includes('-') ? 'next' : 'latest';
}

function main() {
  const arg = process.argv[2] || process.env.GITHUB_REF_NAME || '';
  let result;
  try {
    result = checkReleaseVersion(arg);
  } catch (e) {
    console.error(`❌ ${e.message || e}`);
    process.exit(1);
  }

  if (!result.ok) {
    console.error(`❌ Tag version ${result.version} does not match all packages:`);
    for (const m of result.mismatches) {
      console.error(`   - ${m.name}@${m.version}`);
    }
    process.exit(1);
  }

  console.log(`✅ All packages match ${result.version}`);
  console.log(`   dist-tag: ${distTagForVersion(result.version)}`);
}

const isDirect =
  process.argv[1] &&
  fileURLToPath(import.meta.url) === process.argv[1];

if (isDirect) {
  main();
}
