/**
 * CORS origin allowlist helpers.
 *
 * Default patterns (anchored, case-insensitive):
 * - https://*.webflow.io / https://*.webflow.com (any subdomain depth; apex included)
 * - https://*.sp
 * - http(s)://localhost[:port]
 * - http(s)://127.0.0.1[:port]
 * - per-project live hostnames / *.wildcards / https:// origins
 */

const UNSAFE_ORIGIN_RE = /[\s#"'{}$\\;()[\],<>|/]/;
const HOSTNAME_LABEL_RE = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

/** Built-in Origin regex alternatives (without leading ^ / trailing $ / (?i)). */
export const DEFAULT_ORIGIN_ALTERNATIVES = Object.freeze([
  'https://([a-z0-9-]+\\.)*webflow\\.io',
  'https://([a-z0-9-]+\\.)*webflow\\.com',
  'https://([a-z0-9-]+\\.)*[a-z0-9-]+\\.sp',
  'https?://localhost(:[0-9]{1,5})?',
  'https?://127\\.0\\.0\\.1(:[0-9]{1,5})?',
]);

/**
 * Validate a single live-domain / origin entry.
 * Accepts: example.com | www.example.com | *.example.com | https://example.com
 *
 * @param {string} input
 * @returns {{ ok: true, value: string } | { ok: false, error: string }}
 */
export function validateOriginEntry(input) {
  if (typeof input !== 'string' || input.trim() === '') {
    return { ok: false, error: 'Origin entry is empty.' };
  }

  let raw = input.trim().toLowerCase();

  if (/[\x00-\x1f\x7f]/.test(raw)) {
    return { ok: false, error: 'Origin contains control characters.' };
  }

  // Optional https:// only (http reserved for localhost defaults)
  if (raw.startsWith('http://')) {
    return { ok: false, error: 'Live origins must use https:// (or a bare hostname).' };
  }
  if (raw.startsWith('https://')) {
    raw = raw.slice('https://'.length);
  }

  // Reject paths / query / credentials leftovers
  if (raw.includes('/') || raw.includes('?') || raw.includes('@') || raw.includes(':')) {
    return { ok: false, error: 'Origin must be a hostname (optional leading *.), no path or port.' };
  }

  let wildcard = false;
  if (raw.startsWith('*.')) {
    wildcard = true;
    raw = raw.slice(2);
  }

  if (!raw || raw.startsWith('.') || raw.endsWith('.') || raw.includes('..')) {
    return { ok: false, error: 'Invalid hostname in origin entry.' };
  }

  // After stripping protocol / wildcard, remaining must be safe hostname chars only
  if (UNSAFE_ORIGIN_RE.test(raw) || raw.includes('*')) {
    return { ok: false, error: 'Origin contains invalid characters.' };
  }

  const labels = raw.split('.');
  if (!labels.every((l) => HOSTNAME_LABEL_RE.test(l))) {
    return { ok: false, error: 'Origin hostname labels are not DNS-safe.' };
  }

  const value = wildcard ? `*.${raw}` : raw;
  return { ok: true, value };
}

/**
 * @param {string[]} entries
 * @returns {{ ok: true, origins: string[] } | { ok: false, error: string }}
 */
export function validateOriginList(entries) {
  const out = [];
  const seen = new Set();
  for (const entry of entries || []) {
    const result = validateOriginEntry(entry);
    if (!result.ok) return result;
    if (!seen.has(result.value)) {
      seen.add(result.value);
      out.push(result.value);
    }
  }
  return { ok: true, origins: out };
}

/**
 * Escape a hostname for use inside a RE2 / Caddy regex (dots only; labels already validated).
 * @param {string} hostname
 */
export function escapeHostnameForRegex(hostname) {
  return hostname.replace(/\./g, '\\.');
}

/**
 * Convert a stored origin entry into a regex alternative matching https://...
 * @param {string} entry - validated hostname or *.hostname
 */
export function originEntryToRegexAlternative(entry) {
  if (entry.startsWith('*.')) {
    const host = escapeHostnameForRegex(entry.slice(2));
    return `https://([a-z0-9-]+\\.)*${host}`;
  }
  return `https://${escapeHostnameForRegex(entry)}`;
}

/**
 * Full Origin header regex for Caddy header_regexp (includes (?i) and anchors).
 * @param {string[]} [customOrigins]
 */
export function buildOriginAllowlistRegex(customOrigins = []) {
  const validated = validateOriginList(customOrigins);
  const customs = validated.ok ? validated.origins : [];
  const parts = [
    ...DEFAULT_ORIGIN_ALTERNATIVES,
    ...customs.map(originEntryToRegexAlternative),
  ];
  return `(?i)^(?:${parts.join('|')})$`;
}

/**
 * Whether a browser Origin would match the allowlist (for unit tests).
 * Note: Caddy/RE2 accepts (?i) inline; JS RegExp needs the `i` flag instead.
 * @param {string} origin
 * @param {string[]} [customOrigins]
 */
export function originMatchesAllowlist(origin, customOrigins = []) {
  try {
    let pattern = buildOriginAllowlistRegex(customOrigins);
    let flags = '';
    if (pattern.startsWith('(?i)')) {
      pattern = pattern.slice(4);
      flags = 'i';
    }
    return new RegExp(pattern, flags).test(origin);
  } catch {
    return false;
  }
}
