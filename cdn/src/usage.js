// Privacy-preserving usage point for Workers Analytics Engine.
// One point per request. The index is the embedding hostname.
//
// Blob order is fixed (SQL blob1..blob10):
//   1 env                  staging | production
//   2 host                 embedding hostname, "none", or "invalid"
//   3 internal             "1" or "0"
//   4 package              loader | modules | unknown | ""
//   5 resolvedVersion      exact version served or redirected to, or ""
//   6 specKind             exact | range | latest | none
//   7 spec                 version token only ("2", "2.x", "latest", "2.5.0"), or ""
//   8 file                 manifest-relative file name, or ""
//   9 country              request.cf.country, or "XX"
//  10 status               HTTP status as a string
//
// Doubles: [1, status]. Queries must use SUM(_sample_interval), not SUM(double1),
// because Analytics Engine may sample a point and record the rate in _sample_interval.
//
// The point must not contain an IP, a user agent, a cookie, a page path, a query
// string, or any other visitor identifier. Callers pass the fields above and
// nothing else.

export const USAGE_BLOB_ORDER = Object.freeze([
  'env',
  'host',
  'internal',
  'package',
  'resolvedVersion',
  'specKind',
  'spec',
  'file',
  'country',
  'status',
]);

export const DEFAULT_INTERNAL_HOSTS = 'stagepass.one,*.stagepass.one,localhost,127.0.0.1';

const HOST_CHARS = /^[a-z0-9.-]+$/;
const INDEX_MAX_BYTES = 96;
const BLOB_MAX_CHARS = 128;

function clipChars(value, max) {
  const text = typeof value === 'string' ? value : value == null ? '' : String(value);
  return text.length <= max ? text : text.slice(0, max);
}

function clipBytes(value, max) {
  const text = typeof value === 'string' ? value : '';
  if (new TextEncoder().encode(text).byteLength <= max) return text;
  let low = 0;
  let high = text.length;
  while (low < high) {
    const mid = Math.ceil((low + high) / 2);
    if (new TextEncoder().encode(text.slice(0, mid)).byteLength <= max) low = mid;
    else high = mid - 1;
  }
  return text.slice(0, low);
}

function headerValue(request, name) {
  if (!request || !request.headers || typeof request.headers.get !== 'function') return null;
  const value = request.headers.get(name);
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length === 0 ? null : trimmed;
}

// Hostname only. Port, userinfo, path, query, and fragment are dropped.
// An IPv6 literal contains ":" so it fails HOST_CHARS and becomes "invalid".
// An IPv4 literal is a normal hostname ("127.0.0.1").
function hostFromUrl(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    return 'invalid';
  }
  let host = url.hostname;
  if (typeof host !== 'string') return 'invalid';
  host = host.toLowerCase().replace(/\.+$/, '');
  if (host.length === 0) return 'invalid';
  if (new TextEncoder().encode(host).byteLength > INDEX_MAX_BYTES) return 'invalid';
  if (!HOST_CHARS.test(host)) return 'invalid';
  return host;
}

// Origin wins. A missing Origin falls through to Referer. The opaque Origin
// value "null" is "none" and does not fall through. An unparsable Origin is
// "invalid" and does not fall through.
export function embeddingHost(request) {
  const origin = headerValue(request, 'origin');
  if (origin !== null) {
    if (origin.toLowerCase() === 'null') return 'none';
    return hostFromUrl(origin);
  }
  const referer = headerValue(request, 'referer');
  if (referer !== null) return hostFromUrl(referer);
  return 'none';
}

export function countryCode(request) {
  const cf = request && request.cf;
  const country = cf && typeof cf.country === 'string' ? cf.country : '';
  if (/^[A-Za-z]{2}$/.test(country)) return country.toUpperCase();
  return 'XX';
}

function normalizePattern(raw) {
  if (typeof raw !== 'string') return null;
  let value = raw.trim().toLowerCase().replace(/\.+$/, '');
  if (value.length === 0) return null;
  if (value.startsWith('*.')) {
    const suffix = value.slice(2).replace(/\.+$/, '');
    if (!HOST_CHARS.test(suffix) || suffix.length === 0) return null;
    return `*.${suffix}`;
  }
  if (!HOST_CHARS.test(value)) return null;
  return value;
}

export function parseInternalHosts(value) {
  const source = typeof value === 'string' && value.trim() ? value : DEFAULT_INTERNAL_HOSTS;
  const patterns = [];
  for (const part of source.split(',')) {
    const pattern = normalizePattern(part);
    if (pattern) patterns.push(pattern);
  }
  return patterns;
}

// `*.example.com` matches a host that ends in `.example.com`. It does not
// match `example.com` itself; list the apex separately for an exact match.
export function isInternal(host, list) {
  if (typeof host !== 'string' || host === 'none' || host === 'invalid') return false;
  const patterns = Array.isArray(list) ? list : parseInternalHosts(list);
  for (const pattern of patterns) {
    if (typeof pattern !== 'string') continue;
    if (pattern.startsWith('*.')) {
      const suffix = pattern.slice(2);
      if (suffix && host.endsWith(`.${suffix}`)) return true;
    } else if (host === pattern) {
      return true;
    }
  }
  return false;
}

export function usagePoint({
  host,
  internal,
  env,
  pkg,
  resolvedVersion,
  specKind,
  spec,
  file,
  country,
  status,
}) {
  const indexHost = clipBytes(typeof host === 'string' ? host : '', INDEX_MAX_BYTES);
  const internalFlag = internal === true || internal === '1' || internal === 1 ? '1' : '0';
  const statusNumber = Number(status);
  const statusDouble = Number.isFinite(statusNumber) ? statusNumber : 0;
  const blobs = [
    env,
    indexHost,
    internalFlag,
    pkg,
    resolvedVersion,
    specKind,
    spec,
    file,
    country,
    Number.isFinite(statusNumber) ? String(statusNumber) : '',
  ].map((value) => clipChars(value, BLOB_MAX_CHARS));
  return {
    indexes: [indexHost],
    blobs,
    doubles: [1, statusDouble],
  };
}
