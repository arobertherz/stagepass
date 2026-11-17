#!/usr/bin/env node
/**
 * Fail when an exact pin for @stagepass/loader or @stagepass/modules is not
 * in the published npm version list. A published exact pin that is not the
 * `latest` dist-tag is a warning and does not change the exit code.
 * Major pins (@2, @2.x) are not checked.
 *
 * Pin heuristic (exact pins only):
 * - SNIPPET_LOADER_VERSION / SNIPPET_MODULES_VERSION string literals
 * - data-stagepass-version="x.y.z" (loader; semver only, not a cache-bust date)
 * - @stagepass/loader@x.y.z and @stagepass/modules@x.y.z, including prereleases
 * - on a line that says "exact pin": "loader @x.y.z" and "modules @x.y.z"
 *
 * Not pins: major aliases @2 and @2.x, bare prose such as "ships since 2.4.0",
 * and historical notes in CHANGELOG.md. Tests, dist, and node_modules are not scanned.
 * cdn-base.js is the source for generated snippet exact pins.
 *
 * Default (CI / release): `npm view @stagepass/<pkg> versions dist-tags --json`.
 * No auth. `dist-tags.latest` is the current latest. `next` is not.
 * Offline: STAGEPASS_PUBLISHED_VERSIONS=/path/to.json
 *   { "loader": ["2.4.0", "2.5.0"], "modules": ["2.2.2"],
 *     "latest": { "loader": "2.5.0", "modules": "2.2.2" } }
 * When `latest` is omitted, the last entry of each array is used.
 * When that variable is set, the registry is not contacted.
 *
 * Optional first argument: directory to scan (default: repo root).
 */

import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const EXACT = String.raw`[0-9]+\.[0-9]+\.[0-9]+(?:-[0-9A-Za-z]+(?:\.[0-9A-Za-z]+)*)?`;

const FILE_GLOBS = [
  'README.md',
  'AGENTS.md',
  'AGENTS.LOADER.md',
  'AGENTS.MODULES.md',
  'RELEASING.md',
  'MIGRATION.md',
  'packages/cli/README.md',
  'packages/loader/README.md',
  'packages/modules/README.md',
  'packages/cli/src/lib/cdn-base.js',
  'packages/cli/src/lib/snippets.js',
  'packages/cli/src/lib/ai-guide.js',
];

const WALK_DIRS = ['docs', 'packages/cli/templates'];

/**
 * @param {string} root
 * @returns {string[]} absolute paths
 */
export function listPinFiles(root = ROOT) {
  const files = [];
  for (const rel of FILE_GLOBS) {
    const abs = join(root, rel);
    if (existsSync(abs)) files.push(abs);
  }
  for (const rel of WALK_DIRS) {
    walk(join(root, rel), files);
  }
  return files;
}

function walk(dir, acc) {
  if (!existsSync(dir)) return;
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === 'dist' || name === '.git') continue;
    const abs = join(dir, name);
    const st = statSync(abs);
    if (st.isDirectory()) walk(abs, acc);
    else if (/\.(md|html|js|mjs|tmpl)$/.test(name)) acc.push(abs);
  }
}

/**
 * @param {string} text
 * @param {string} file relative path
 * @returns {{ file: string, line: number, package: 'loader'|'modules', version: string }[]}
 */
export function pinsInText(text, file) {
  const pins = [];
  const lines = String(text).split('\n');
  const loaderConst = new RegExp(`SNIPPET_LOADER_VERSION\\s*=\\s*['"](${EXACT})['"]`, 'g');
  const modulesConst = new RegExp(`SNIPPET_MODULES_VERSION\\s*=\\s*['"](${EXACT})['"]`, 'g');
  const attr = new RegExp(`data-stagepass-version\\s*=\\s*['"](${EXACT})['"]`, 'g');
  const loaderUrl = new RegExp(`@stagepass/loader@(${EXACT})(?![0-9A-Za-z-])`, 'g');
  const modulesUrl = new RegExp(`@stagepass/modules@(${EXACT})(?![0-9A-Za-z-])`, 'g');
  const loaderHint = new RegExp(`\\bloader\\s+@(${EXACT})(?![0-9A-Za-z-])`, 'g');
  const modulesHint = new RegExp(`\\bmodules\\s+@(${EXACT})(?![0-9A-Za-z-])`, 'g');

  lines.forEach((line, index) => {
    const lineNo = index + 1;
    const add = (pkg, version) => {
      pins.push({ file, line: lineNo, package: pkg, version });
    };
    for (const match of line.matchAll(loaderConst)) add('loader', match[1]);
    for (const match of line.matchAll(modulesConst)) add('modules', match[1]);
    for (const match of line.matchAll(attr)) add('loader', match[1]);
    for (const match of line.matchAll(loaderUrl)) add('loader', match[1]);
    for (const match of line.matchAll(modulesUrl)) add('modules', match[1]);
    if (/exact pin/i.test(line)) {
      for (const match of line.matchAll(loaderHint)) add('loader', match[1]);
      for (const match of line.matchAll(modulesHint)) add('modules', match[1]);
    }
  });
  return pins;
}

/**
 * @param {string} [root]
 */
export function collectPins(root = ROOT) {
  const pins = [];
  for (const abs of listPinFiles(root)) {
    const rel = relative(root, abs).split('\\').join('/');
    pins.push(...pinsInText(readFileSync(abs, 'utf8'), rel));
  }
  return pins;
}

/**
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {{ loader: string[], modules: string[], latest: { loader?: string, modules?: string } }}
 */
export function loadPublishedVersions(env = process.env) {
  const mock = env.STAGEPASS_PUBLISHED_VERSIONS;
  if (mock) {
    let parsed;
    try {
      parsed = JSON.parse(readFileSync(mock, 'utf8'));
    } catch (error) {
      throw new Error(`Cannot read STAGEPASS_PUBLISHED_VERSIONS (${mock}): ${error.message || error}`);
    }
    const loader = parsed.loader || parsed['@stagepass/loader'];
    const modules = parsed.modules || parsed['@stagepass/modules'];
    if (!Array.isArray(loader) || !Array.isArray(modules)) {
      throw new Error('STAGEPASS_PUBLISHED_VERSIONS must be JSON with loader and modules arrays');
    }
    const latestField = parsed.latest || {};
    return {
      loader,
      modules,
      latest: {
        loader: latestField.loader || latestField['@stagepass/loader'] || lastVersion(loader),
        modules: latestField.modules || latestField['@stagepass/modules'] || lastVersion(modules),
      },
    };
  }
  const loaderInfo = npmPackageFacts('loader');
  const modulesInfo = npmPackageFacts('modules');
  return {
    loader: loaderInfo.versions,
    modules: modulesInfo.versions,
    latest: { loader: loaderInfo.latest, modules: modulesInfo.latest },
  };
}

function lastVersion(list) {
  return list.length > 0 ? list[list.length - 1] : undefined;
}

function asVersionList(value, name) {
  if (typeof value === 'string') return [value];
  if (!Array.isArray(value)) {
    throw new Error(`Unexpected versions payload for @stagepass/${name}`);
  }
  return value;
}

function npmPackageFacts(name) {
  const raw = execFileSync(
    'npm',
    ['view', `@stagepass/${name}`, 'versions', 'dist-tags', '--json'],
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }
  );
  const parsed = JSON.parse(raw);
  const versions = asVersionList(parsed.versions, name);
  const latest = parsed['dist-tags'] && parsed['dist-tags'].latest;
  if (typeof latest !== 'string' || !latest) {
    throw new Error(`No latest dist-tag for @stagepass/${name}`);
  }
  return { versions, latest };
}

/**
 * @param {{ file: string, line: number, package: string, version: string }[]} pins
 * @param {{ loader: string[], modules: string[], latest?: { loader?: string, modules?: string } }} published
 */
export function unpublishedPins(pins, published) {
  return pins.filter((pin) => {
    const list = published[pin.package] || [];
    return !list.includes(pin.version);
  });
}

/**
 * Published exact pins that are not the `latest` dist-tag. Major pins never
 * reach this list. Unpublished pins are errors, not warnings.
 * @param {{ file: string, line: number, package: string, version: string }[]} pins
 * @param {{ loader: string[], modules: string[], latest?: { loader?: string, modules?: string } }} published
 */
export function outdatedPins(pins, published) {
  const latest = published.latest || {};
  return pins.filter((pin) => {
    const list = published[pin.package] || [];
    const current = latest[pin.package];
    if (!current || !list.includes(pin.version)) return false;
    return pin.version !== current;
  });
}

function main() {
  if (process.argv.length > 3) {
    console.error('Extra arguments are not allowed');
    process.exit(1);
  }
  const root = process.argv[2] || ROOT;
  let pins;
  let published;
  try {
    pins = collectPins(root);
    published = loadPublishedVersions();
  } catch (error) {
    console.error(error.message || error);
    process.exit(1);
  }
  if (pins.length === 0) {
    console.error(
      'Published-version gate found no exact pins (check the scan root and pin files).'
    );
    process.exit(1);
  }
  const missing = unpublishedPins(pins, published);
  const stale = outdatedPins(pins, published);
  for (const pin of stale) {
    const current = published.latest[pin.package];
    console.error(
      `${pin.file}:${pin.line}: warning: @stagepass/${pin.package}@${pin.version} is published but not latest (latest is ${current})`
    );
  }
  if (missing.length > 0) {
    for (const pin of missing) {
      console.error(
        `${pin.file}:${pin.line}: unpublished @stagepass/${pin.package}@${pin.version}`
      );
    }
    process.exit(1);
  }
  const note = stale.length > 0 ? `, ${stale.length} outdated` : '';
  console.log(`Published-version gate ok (${pins.length} exact pins${note}).`);
}

const isDirect = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isDirect) main();
