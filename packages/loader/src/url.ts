/**
 * Append a query parameter while preserving existing query strings and hashes.
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
  const base = hashIdx >= 0 ? url.slice(0, hashIdx) : url;
  const sep = base.includes('?') ? '&' : '?';
  return `${base}${sep}${encodeURIComponent(key)}=${encoded}${hash}`;
}

/**
 * Build a local asset URL for an active Stagepass session.
 *
 * @param domain - Valid .sp / localhost domain
 * @param relativePath - Path under the local root
 * @param cacheBust - Timestamp or version token for `?_cb=`
 */
export function buildLocalAssetUrl(
  domain: string,
  relativePath: string,
  cacheBust: number | string
): string {
  const clean = relativePath.startsWith('/')
    ? relativePath.substring(1)
    : relativePath;
  return `https://${domain}/${clean}?_cb=${encodeURIComponent(String(cacheBust))}`;
}
