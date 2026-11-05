/** Read-only npm registry lookups for @stagepass/* packages. */

import fs from 'fs-extra';
import path from 'node:path';
import { defaultExec } from './exec.js';
import { MODULE_IDS } from './project-modules.js';
import { STAGEPASS_PACKAGES_VERSION } from './versions.js';

/** Major range for new projects (matches `@2` CDN embed policy).  */
export const PACKAGES_MAJOR_RANGE = '^2';

/** First @stagepass/modules release with per-module type entry points.  */
export const PER_MODULE_TYPES_SINCE = '2.2.0';

const SEMVER_RE = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z.-]+))?$/;
const PKG_NAME_RE = /^@stagepass\/[a-z0-9][a-z0-9._-]*$/;

/**
 * @param {string} version
 * @returns {{ major: number, minor: number, patch: number, pre: boolean } | null}
 */
export function parseSemver(version) {
  const m = SEMVER_RE.exec(String(version).trim());
  if (!m) return null;
  return { major: +m[1], minor: +m[2], patch: +m[3], pre: Boolean(m[4]) };
}

/**
 * @param {string} a
 * @param {string} b
 * @returns {number}
 */
export function compareSemver(a, b) {
  const x = parseSemver(a);
  const y = parseSemver(b);
  if (!x || !y) return 0;
  return x.major - y.major || x.minor - y.minor || x.patch - y.patch;
}

/**
 * @param {string} version
 * @param {string} range
 * @returns {boolean}
 */
export function satisfiesSimple(version, range) {
  const v = parseSemver(version);
  if (!v || v.pre) return false;
  const r = String(range).trim();
  const m = /^([~^]?)(\d+)(?:\.(\d+))?(?:\.(\d+))?$/.exec(r);
  if (!m) return false;
  const [, op, majS, minS, patS] = m;
  const maj = +majS;
  const min = minS == null ? 0 : +minS;
  const pat = patS == null ? 0 : +patS;
  const base = `${maj}.${min}.${pat}`;
  if (op === '') {
    if (minS == null || patS == null) {
      return v.major === maj && (minS == null || v.minor === min);
    }
    return compareSemver(version, base) === 0;
  }
  if (compareSemver(version, base) < 0) return false;
  if (op === '~') {
    return v.major === maj && (minS == null ? true : v.minor === min);
  }
  // caret (major >= 1 for all @stagepass releases)
  if (maj > 0) return v.major === maj;
  if (min > 0) return v.major === 0 && v.minor === min;
  return v.major === 0 && v.minor === 0 && v.patch === pat;
}

/**
 * @param {string[]} versions
 * @param {string} range
 * @returns {string | null}
 */
export function maxSatisfying(versions, range) {
  let best = null;
  for (const v of versions || []) {
    if (satisfiesSimple(v, range) && (best == null || compareSemver(v, best) > 0)) best = v;
  }
  return best;
}

/**
 * @param {string} name
 * @param {{ exec?: import('./exec.js').ExecFn, timeoutMs?: number }} [deps]
 * @returns {Promise<{ distTags: Record<string, string>, versions: string[] } | null>}
 */
export async function fetchPublished(name, deps = {}) {
  if (!PKG_NAME_RE.test(name)) throw new Error(`Invalid package name: ${name}`);
  const exec = deps.exec || defaultExec;
  let stdout;
  try {
    const result = await exec('npm', ['view', name, 'dist-tags', 'versions', '--json'], {
      timeout: deps.timeoutMs ?? 15000,
    });
    if (result && typeof result.code === 'number' && result.code !== 0) return null;
    stdout = String(result?.stdout || '');
  } catch {
    return null;
  }
  let data;
  try {
    data = JSON.parse(stdout);
  } catch {
    return null;
  }
  if (!data || typeof data !== 'object') return null;
  const rawVersions = Array.isArray(data.versions)
    ? data.versions
    : typeof data.versions === 'string'
      ? [data.versions]
      : [];
  const versions = rawVersions.filter((v) => typeof v === 'string' && parseSemver(v));
  /** @type {Record<string, string>} */
  const distTags = {};
  const tags = data['dist-tags'];
  if (tags && typeof tags === 'object') {
    for (const [tag, v] of Object.entries(tags)) {
      if (/^[a-z][a-z0-9_-]*$/i.test(tag) && typeof v === 'string' && parseSemver(v)) distTags[tag] = v;
    }
  }
  if (versions.length === 0) return null;
  return { distTags, versions };
}

/**
 * @param {string[] | null | undefined} versions
 * @param {string} range
 * @returns {boolean | null} null when unknown (no registry data)
 */
export function rangeHasPerModuleTypes(versions, range) {
  if (!versions) return null;
  const best = maxSatisfying(versions, range);
  if (!best) return false;
  return compareSemver(best, PER_MODULE_TYPES_SINCE) >= 0;
}

/**
 * @param {string} cwd
 * @param {typeof fs} [fse]
 * @returns {Promise<boolean | null>} null when not installed
 */
export async function installedHasPerModuleTypes(cwd, fse = fs) {
  const dir = path.join(cwd, 'node_modules', '@stagepass', 'modules');
  if (!(await fse.pathExists(path.join(dir, 'package.json')))) return null;
  for (const id of MODULE_IDS) {
    if (!(await fse.pathExists(path.join(dir, `${id}.d.ts`)))) return false;
  }
  return true;
}

/**
 * @param {string} cwd
 * @param {typeof fs} [fse]
 * @returns {Promise<string | null>}
 */
export async function installedLoaderVersion(cwd, fse = fs) {
  const file = path.join(cwd, 'node_modules', '@stagepass', 'loader', 'package.json');
  try {
    if (!(await fse.pathExists(file))) return null;
    const pkg = await fse.readJson(file);
    const version = typeof pkg?.version === 'string' ? pkg.version.trim() : '';
    return satisfiesSimple(version, PACKAGES_MAJOR_RANGE) ? version : null;
  } catch {
    return null;
  }
}

/**
 * Loader version for Webflow snippets (AC-14); never the CLI version.
 * @param {object} options
 * @param {{ distTags: Record<string, string>, versions: string[] } | null} options.published
 * @param {string} options.cwd
 * @param {string} [options.bundled]
 * @param {typeof fs} [options.fse]
 * @returns {Promise<string>}
 */
export async function resolveSnippetLoaderVersion({ published, cwd, bundled, fse = fs }) {
  const best = published ? maxSatisfying(published.versions, PACKAGES_MAJOR_RANGE) : null;
  if (best) return best;
  return (await installedLoaderVersion(cwd, fse)) || bundled || STAGEPASS_PACKAGES_VERSION;
}
