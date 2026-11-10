#!/usr/bin/env node
/**
 * Write or verify packages/cli/src/lib/package-versions.js from the monorepo
 * package.json versions. The published CLI cannot read the monorepo at runtime,
 * so this generated module is committed and refreshed before release.
 *
 * Usage:
 *   node scripts/sync-cli-versions.mjs          # write when drifted
 *   node scripts/sync-cli-versions.mjs --check  # exit 1 when drifted (no write)
 * Exit 0 when the file already matches (idempotent).
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'packages', 'cli', 'src', 'lib', 'package-versions.js');
const checkOnly = process.argv.includes('--check');

function readPkgVersion(dir) {
  const pkg = JSON.parse(readFileSync(join(ROOT, 'packages', dir, 'package.json'), 'utf8'));
  if (typeof pkg.version !== 'string' || !pkg.version.trim()) {
    throw new Error(`Missing version in packages/${dir}/package.json`);
  }
  return pkg.version.trim();
}

function render(loaderVersion, modulesVersion) {
  return `/**
 * GENERATED FILE. Do not edit by hand.
 * Run: node scripts/sync-cli-versions.mjs
 *
 * Sourced from packages/loader and packages/modules package.json at generate time.
 * The published CLI ships this snapshot; it cannot read the monorepo at runtime.
 */
export const LOADER_VERSION = ${JSON.stringify(loaderVersion)};
export const MODULES_VERSION = ${JSON.stringify(modulesVersion)};
`;
}

const loaderVersion = readPkgVersion('loader');
const modulesVersion = readPkgVersion('modules');
const next = render(loaderVersion, modulesVersion);

let prev = '';
try {
  prev = readFileSync(OUT, 'utf8');
} catch {
  prev = '';
}

// Messages go to stderr so `npm pack --json` (which runs prepack) stays valid JSON.
if (prev === next) {
  console.error(
    `package-versions.js up to date (loader ${loaderVersion}, modules ${modulesVersion})`
  );
  process.exit(0);
}

if (checkOnly) {
  console.error(
    `package-versions.js is out of date (expected loader ${loaderVersion}, modules ${modulesVersion}). Run: node scripts/sync-cli-versions.mjs`
  );
  process.exit(1);
}

writeFileSync(OUT, next, 'utf8');
console.error(
  `Wrote package-versions.js (loader ${loaderVersion}, modules ${modulesVersion})`
);
