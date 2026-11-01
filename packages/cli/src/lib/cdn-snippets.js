/**
 * Canonical CDN embed snippets recommended by Stagepass docs.
 * Doctor checks these so generated / documented snippets never drift to @latest.
 * Do not scan user sites.
 */
export const RECOMMENDED_CDN_SNIPPETS = Object.freeze([
  'https://cdn.jsdelivr.net/npm/@stagepass/loader@2/dist/loader.min.js',
  'https://cdn.jsdelivr.net/npm/@stagepass/modules@2/dist/inject.min.js',
  'https://cdn.jsdelivr.net/npm/@stagepass/modules@2/dist/cookies.min.js',
  'https://unpkg.com/@stagepass/loader@2/dist/loader.min.js',
]);

const UNPINNED_RE = /@(?:latest)(?=[/"'?]|$)/i;

/**
 * @param {string[]} [snippets]
 * @returns {{ ok: boolean, offenders: string[] }}
 */
export function findUnpinnedCdnSnippets(snippets = RECOMMENDED_CDN_SNIPPETS) {
  const offenders = snippets.filter((s) => UNPINNED_RE.test(s));
  return { ok: offenders.length === 0, offenders };
}

/** Chrome Local Network Access hint (public HTTPS → loopback). */
export const CHROME_LNA_HINT =
  'Chrome may block public HTTPS pages from reaching local .sp hosts until Local Network Access is allowed for the site (site settings → Local network access).';
