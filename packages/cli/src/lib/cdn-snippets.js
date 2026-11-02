import fs from 'fs-extra';
import path from 'node:path';

/**
 * Canonical CDN embed snippets recommended by Stagepass docs.
 * Doctor checks these so generated / documented snippets never drift to @latest.
 */
export const RECOMMENDED_CDN_SNIPPETS = Object.freeze([
  'https://cdn.jsdelivr.net/npm/@stagepass/loader@2/dist/loader.min.js',
  'https://cdn.jsdelivr.net/npm/@stagepass/modules@2/dist/inject.min.js',
  'https://cdn.jsdelivr.net/npm/@stagepass/modules@2/dist/cookies.min.js',
  'https://cdn.jsdelivr.net/npm/@stagepass/modules@2/dist/maintenance.min.js',
  'https://cdn.jsdelivr.net/npm/@stagepass/modules@2/dist/all.min.js',
]);

/**
 * Unpinned / legacy CDN pins for @stagepass/loader and @stagepass/modules:
 * - `@latest`
 * - bare major `@1` (not `@1.2.0` exact pins)
 * - package URL with no `@version` at all
 *
 * Matches jsDelivr and unpkg-style paths.
 */
export const UNPINNED_CDN_RE =
  /(?:cdn\.jsdelivr\.net\/npm|unpkg\.com)\/@stagepass\/(?:loader|modules)(?:@latest|@1(?![0-9.])|(?!@))(?=[/"'?\s]|$)/gi;

/**
 * Test whether a single URL/snippet string is an unpinned Stagepass CDN reference.
 * @param {string} snippet
 * @returns {boolean}
 */
export function isUnpinnedCdnSnippet(snippet) {
  const text = String(snippet || '');
  UNPINNED_CDN_RE.lastIndex = 0;
  return UNPINNED_CDN_RE.test(text);
}

/**
 * @param {string[]} [snippets]
 * @returns {{ ok: boolean, offenders: string[] }}
 */
export function findUnpinnedCdnSnippets(snippets = RECOMMENDED_CDN_SNIPPETS) {
  const offenders = snippets.filter((s) => isUnpinnedCdnSnippet(s));
  return { ok: offenders.length === 0, offenders };
}

/**
 * Extract offending substring matches from free-form file content.
 * @param {string} content
 * @returns {string[]}
 */
export function findUnpinnedCdnMatchesInText(content) {
  const text = String(content || '');
  const candidateRe =
    /(?:https?:\/\/)?(?:cdn\.jsdelivr\.net\/npm|unpkg\.com)\/@stagepass\/(?:loader|modules)[^"'<\s]*/gi;
  const matches = text.match(candidateRe);
  if (!matches) return [];
  const seen = new Set();
  const out = [];
  for (const m of matches) {
    if (!isUnpinnedCdnSnippet(m)) continue;
    if (seen.has(m)) continue;
    seen.add(m);
    out.push(m);
  }
  return out;
}

/** Default project files that may contain Webflow / CDN snippets. */
export const PROJECT_CDN_SCAN_FILES = Object.freeze([
  'README.md',
  'stagepass.json',
  'webflow-head.html',
  'webflow-footer.html',
  'snippets.html',
  'stagepass-snippets.html',
]);

/**
 * Read-only scan of the current project's snippet-bearing files for unpinned CDN URLs.
 *
 * @param {object} [opts]
 * @param {string} [opts.cwd]
 * @param {string[]} [opts.files]
 * @param {(p: string) => Promise<boolean>} [opts.pathExists]
 * @param {(p: string, enc: string) => Promise<string>} [opts.readFile]
 * @returns {Promise<{ ok: boolean, offenders: { file: string, match: string }[] }>}
 */
export async function scanProjectUnpinnedCdn(opts = {}) {
  const cwd = opts.cwd || process.cwd();
  const files = opts.files || PROJECT_CDN_SCAN_FILES;
  const pathExists = opts.pathExists || ((p) => fs.pathExists(p));
  const readFile = opts.readFile || ((p, enc) => fs.readFile(p, enc));
  /** @type {{ file: string, match: string }[]} */
  const offenders = [];

  for (const rel of files) {
    if (typeof rel !== 'string' || rel.includes('..') || path.isAbsolute(rel)) {
      continue;
    }
    const full = path.join(cwd, rel);
    if (!(await pathExists(full))) continue;
    let content = '';
    try {
      content = await readFile(full, 'utf8');
    } catch {
      continue;
    }
    for (const match of findUnpinnedCdnMatchesInText(content)) {
      offenders.push({ file: rel, match });
    }
  }

  return { ok: offenders.length === 0, offenders };
}

/** Chrome Local Network Access hint (public HTTPS → loopback). */
export const CHROME_LNA_HINT =
  'Chrome may block public HTTPS pages from reaching local .sp hosts until Local Network Access is allowed for the site (site settings → Local network access).';
