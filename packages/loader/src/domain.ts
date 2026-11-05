/**
 * Validate a Stagepass session domain / keyword.
 * Only safe hostnames and known keywords are accepted (XSS / URL injection guard).
 *
 * @param d - Candidate domain string
 * @returns Whether the value is allowed for session storage and local URLs
 */
export function isValidDomain(d: string): boolean {
  if (typeof d !== 'string' || !d) return false;
  if (d === 'debug' || d === 'localhost') return true;
  if (d.startsWith('localhost:')) {
    d = d.slice(10);
    return /^\d{1,5}$/.test(d) && +d < 65536;
  }
  // DNS-safe labels ending in .sp only (no spaces, quotes, schemes, paths)
  return /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)*\.sp$/i.test(d);
}

/**
 * Strip scheme and trailing slash from a domain-like string.
 *
 * @param d - Raw domain or URL
 * @returns Cleaned hostname-like string, or null
 */
export function cleanDomain(d: string | null): string | null {
  if (!d) return null;
  return d.replace(/^https?:\/\//i, '').replace(/\/$/, '');
}
