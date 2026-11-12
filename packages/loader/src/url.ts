/**
 * Append a query parameter while preserving the existing query string and hash.
 *
 * Key `_cb` is the nocache path only. Every existing `_cb` parameter in the
 * query is removed, then exactly one `_cb` is appended last (other parameters
 * keep their order). Tokens are matched only after the first `?`, so `&` in
 * the path is left alone and a hash that contains `_cb` is untouched. A
 * page-supplied `_cb` cannot survive. Any other key, including production `v`,
 * is always appended and never replaced, so assets without
 * `data-stagepass-nocache` stay byte-identical to 2.4.0.
 *
 * @param url - Absolute or relative URL
 * @param key - Query key
 * @param value - Query value (URL-encoded). Digits from `Date.now()` need no extra string step.
 */
export function appendQueryParam(url: string, key: string, value: string | number): string {
  if (!url || typeof url !== 'string') return url;
  const encoded = encodeURIComponent(value);
  const hashIdx = url.indexOf('#');
  const hash = hashIdx >= 0 ? url.slice(hashIdx) : '';
  let base = hashIdx >= 0 ? url.slice(0, hashIdx) : url;
  if (key === '_cb') {
    // Only the query is rewritten. A leading `?_cb` leaves a leftover `&`,
    // which is promoted back to `?`. No lookbehind: older Safari would fail
    // to parse the whole loader.
    base = base.replace(/\?.*/, (query) =>
      query.replace(/[&?]_cb(=[^&]*)?(?=&|$)/g, '').replace(/^&/, '?')
    );
  }
  const sep = base.includes('?') ? '&' : '?';
  return `${base}${sep}${encodeURIComponent(key)}=${encoded}${hash}`;
}

/**
 * Build a local asset URL for an active Stagepass session.
 *
 * @param domain - Valid .sp / localhost domain
 * @param relativePath - Path under the local root
 * @param cacheBust - Decimal timestamp (`Date.now` or the session stamp). Digits need no encoding.
 */
export function buildLocalAssetUrl(
  domain: string,
  relativePath: string,
  cacheBust: number | string
): string {
  const clean = relativePath.startsWith('/') ? relativePath.slice(1) : relativePath;
  return `https://${domain}/${clean}?_cb=${cacheBust}`;
}
