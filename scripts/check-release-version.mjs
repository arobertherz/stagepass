#!/usr/bin/env node
/**
 * Verify that a git tag (with or without leading `v`) matches the version
 * field of the Stagepass packages and decide which ones to stage.
 *
 * Full release: every package matches the tag.
 * Partial release (e.g. a CLI-only patch): at least one package matches; only
 * matching packages are staged, the others keep their already staged/published
 * version. With GITHUB_OUTPUT set, writes `stage_<dir>=true|false`.
 *
 * Usage:
 *   node scripts/check-release-version.mjs v2.0.0
 *   node scripts/check-release-version.mjs 2.0.0
 *   GITHUB_REF_NAME=v2.0.0 node scripts/check-release-version.mjs
 *
 * Exit 0 when at least one package matches, 1 otherwise.
 */

import { appendFileSync, readFileSync } from 'node:fs';
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
 * Packages to stage for a tag (those whose version equals the tag version).
 * @param {string} tag
 * @param {string} [root]
 * @returns {{ version: string, stage: { dir: string, name: string, version: string }[], skip: { dir: string, name: string, version: string }[] }}
 */
export function releasePlan(tag, root = ROOT) {
  const version = normalizeTagVersion(tag);
  const packages = readPackageVersions(root);
  return {
    version,
    stage: packages.filter((p) => p.version === version),
    skip: packages.filter((p) => p.version !== version),
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
  const arg = process.argv[2] || process.env.GITHUB_REF_NAME || '';
  let plan;
  try {
    plan = releasePlan(arg);
  } catch (e) {
    console.error(`❌ ${e.message || e}`);
    process.exit(1);
  }

  if (plan.stage.length === 0) {
    console.error(`❌ Tag version ${plan.version} does not match any package:`);
    for (const m of plan.skip) {
      console.error(`   - ${m.name}@${m.version}`);
    }
    process.exit(1);
  }

  const distTag = distTagForVersion(plan.version);
  const kind = plan.version.includes('-') ? 'prerelease' : 'stable; promote to latest after verification';
  if (plan.skip.length === 0) {
    console.log(`✅ All packages match ${plan.version}`);
  } else {
    console.log(`✅ Partial release ${plan.version}:`);
    for (const p of plan.stage) console.log(`   stage ${p.name}@${p.version}`);
    for (const p of plan.skip) console.log(`   skip  ${p.name}@${p.version} (unchanged)`);
  }
  console.log(`   npm dist-tag: ${distTag} (${kind})`);

  if (process.env.GITHUB_OUTPUT) {
    const staged = new Set(plan.stage.map((p) => p.dir));
    const lines = PACKAGES.map((dir) => `stage_${dir}=${staged.has(dir)}`);
    lines.push(`dist_tag=${distTag}`);
    appendFileSync(process.env.GITHUB_OUTPUT, `${lines.join('\n')}\n`);
  }
}

const isDirect =
  process.argv[1] &&
  fileURLToPath(import.meta.url) === process.argv[1];

if (isDirect) {
  main();
}
