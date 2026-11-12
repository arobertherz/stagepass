/**
 * Append a query parameter while preserving the existing query string and hash.
 *
 * Key `_cb` is the nocache path only. Every existing `_cb` parameter is removed
 * first, then exactly one `_cb` is appended last (other parameters keep their
 * order). A page-supplied `_cb` cannot survive. Any other key, including
 * production `v`, is always appended and never replaced, so assets without
 * `data-stagepass-nocache` stay byte-identical to 2.4.0.
 *
 * @param url - Absolute or relative URL
 * @param key - Query key
 * @param value - Query value (URL-encoded)
 */
export function appendQueryParam(url: string, key: string, value: string): string {
  if (!url || typeof url !== 'string') return url;
  const encoded = encodeURIComponent(value);
  const hashIdx = url.indexOf('#');
  const hash = hashIdx >= 0 ? url.slice(hashIdx) : '';
  let base = hashIdx >= 0 ? url.slice(0, hashIdx) : url;
  if (key === '_cb') {
    // Drop each `_cb` / `_cb=…` token. If that was the first parameter, the
    // following `&` is promoted back to `?` so the remaining query stays valid.
    base = base
      .replace(/[&?]_cb(?:=[^&]*)?(?=&|$)/g, '')
      .replace(/^([^?#]*?)&/, '$1?');
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
