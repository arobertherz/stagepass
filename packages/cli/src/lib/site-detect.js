/**
 * Detect which Stagepass scripts a live Webflow site loads.
 *
 * Public GET only: https, no cookies or auth headers, max 3 redirects,
 * ~5 s timeout, size cap. The fetched HTML is parsed with regexes for
 * <script src> values and is never executed.
 */

import { validateOriginEntry } from './origins.js';
import { MODULE_CHOICES, normalizeModulesList } from './project-modules.js';

export const DETECT_TIMEOUT_MS = 5000;
export const DETECT_MAX_BYTES = 2 * 1024 * 1024;
export const DETECT_MAX_REDIRECTS = 3;

// Bounded attribute run keeps the scan linear on hostile input.
const SCRIPT_TAG_RE = /<script\b[^<>]{0,4096}>/gi;
const SRC_ATTR_RE = /\ssrc\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/i;
const STAGEPASS_SRC_RE =
  /^(?:https?:)?\/\/(cdn\.jsdelivr\.net\/npm|unpkg\.com)\/@stagepass\/(loader|modules)(?:@([0-9A-Za-z.^~_-]+))?\/dist\/([a-z]+)(?:\.min)?\.js(?:[?#].*)?$/i;

/**
 * Whether a raw URL or URL reference names a port explicitly, `:443` and
 * `:0443` included. `new URL` drops the default port, so the authority is
 * read from the raw string, split the way the WHATWG parser splits an
 * https URL: C0 controls and spaces trimmed, tab and newlines removed, `\`
 * read as `/`, any run of slashes after `https:` or at the start of a
 * protocol-relative reference, userinfo up to the last `@`.
 *
 * @param {string} input absolute URL, protocol-relative or relative reference
 * @returns {boolean}
 */
function hasExplicitPort(input) {
  const s = String(input == null ? '' : input)
    .replace(/^[\u0000-\u0020]+|[\u0000-\u0020]+$/g, '')
    .replace(/[\t\n\r]/g, '')
    .replace(/\\/g, '/');
  const scheme = /^[a-z][a-z0-9+.-]*:/i.exec(s);
  const rest = scheme ? s.slice(scheme[0].length) : s;
  // Without `//` there is no authority (path or query reference).
  if (!rest.startsWith('//')) return false;
  const authority = rest.replace(/^\/+/, '').split(/[/?#]/, 1)[0];
  const hostPort = authority.slice(authority.lastIndexOf('@') + 1);
  if (hostPort.startsWith('[')) {
    const end = hostPort.indexOf(']');
    return end === -1 || hostPort.slice(end + 1).includes(':');
  }
  return hostPort.includes(':');
}

/**
 * Normalize a live site input (host or https URL) to an https URL.
 * Rejects http, wildcards, credentials, and invalid hosts.
 *
 * @param {string} input
 * @returns {{ ok: true, url: string, host: string } | { ok: false, error: string }}
 */
export function normalizeSiteUrl(input) {
  const raw = String(input == null ? '' : input).trim();
  if (!raw) return { ok: false, error: 'No live site given.' };
  let url;
  try {
    url = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `https://${raw}`);
  } catch {
    return { ok: false, error: `Invalid site URL: ${raw}` };
  }
  if (url.protocol !== 'https:') {
    return { ok: false, error: 'Live site must use https.' };
  }
  if (url.username || url.password) {
    return { ok: false, error: 'Site URL must not contain credentials.' };
  }
  if (url.port) {
    return { ok: false, error: 'Site URL must not contain a port.' };
  }
  const host = url.hostname.toLowerCase();
  const check = validateOriginEntry(host);
  if (!check.ok || check.value.startsWith('*.')) {
    return { ok: false, error: `Not a usable site host: ${host}` };
  }
  const path = url.pathname && url.pathname !== '' ? url.pathname : '/';
  return { ok: true, url: `https://${host}${path}`, host };
}

/**
 * Remove `<!-- … -->` comments in linear time (a lazy regex is quadratic on
 * many unterminated `<!--`). An unterminated comment drops the rest.
 *
 * @param {string} html
 * @returns {string}
 */
function stripHtmlComments(html) {
  let out = '';
  let pos = 0;
  while (pos < html.length) {
    const start = html.indexOf('<!--', pos);
    if (start === -1) {
      out += html.slice(pos);
      break;
    }
    out += html.slice(pos, start);
    const end = html.indexOf('-->', start + 4);
    if (end === -1) break;
    pos = end + 3;
  }
  return out;
}

/**
 * Parse Stagepass loader / module script tags from HTML (no execution).
 *
 * @param {string} html
 * @returns {{ loader: { version: string, cdn: string } | null, modules: { id: string, version: string, cdn: string }[] }}
 */
export function parseStagepassScripts(html) {
  /** @type {{ version: string, cdn: string } | null} */
  let loader = null;
  /** @type {Map<string, { id: string, version: string, cdn: string }>} */
  const modules = new Map();
  // Ignore commented-out tags; the HTML is only scanned, never executed.
  const source = stripHtmlComments(String(html || ''));

  for (const match of source.matchAll(SCRIPT_TAG_RE)) {
    const tag = match[0];
    const attr = SRC_ATTR_RE.exec(tag);
    if (!attr) continue;
    const src = (attr[1] ?? attr[2] ?? attr[3] ?? '').trim();
    const m = STAGEPASS_SRC_RE.exec(src);
    if (!m) continue;
    const cdn = m[1].toLowerCase().startsWith('unpkg') ? 'unpkg' : 'jsdelivr';
    const pkg = m[2].toLowerCase();
    const version = m[3] || 'latest';
    const file = m[4].toLowerCase();
    if (pkg === 'loader') {
      if (file === 'loader' && !loader) loader = { version, cdn };
      continue;
    }
    if (MODULE_CHOICES.includes(file) && !modules.has(file)) {
      modules.set(file, { id: file, version, cdn });
    }
  }

  return { loader, modules: [...modules.values()] };
}

/**
 * Declared-list form of detected modules (`all` wins).
 * @param {{ modules: { id: string }[] }} detection
 * @returns {string[]}
 */
export function detectedModulesList(detection) {
  const result = normalizeModulesList(detection.modules.map((m) => m.id));
  return result.ok ? result.modules : [];
}

/**
 * Read a response body up to `maxBytes` (truncates; never throws on size).
 * @param {Response} res
 * @param {number} maxBytes
 */
async function readCapped(res, maxBytes) {
  if (!res.body || typeof res.body.getReader !== 'function') {
    const text = await res.text();
    return text.slice(0, maxBytes);
  }
  const reader = res.body.getReader();
  const chunks = [];
  let total = 0;
  while (total < maxBytes) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    total += value.byteLength;
  }
  try {
    await reader.cancel();
  } catch {
    // ignore
  }
  const buf = Buffer.concat(chunks.map((c) => Buffer.from(c)));
  return buf.subarray(0, maxBytes).toString('utf8');
}

/**
 * Fetch a live page and detect Stagepass scripts.
 *
 * @param {string} siteInput host or https URL
 * @param {object} [deps]
 * @param {typeof fetch} [deps.fetch]
 * @param {number} [deps.timeoutMs]
 * @param {number} [deps.maxBytes]
 * @returns {Promise<{ ok: true, url: string, loader: { version: string, cdn: string } | null, modules: { id: string, version: string, cdn: string }[], list: string[] } | { ok: false, url?: string, error: string }>}
 */
export async function detectSite(siteInput, deps = {}) {
  const normalized = normalizeSiteUrl(siteInput);
  if (!normalized.ok) return { ok: false, error: normalized.error };

  const fetchImpl = deps.fetch || globalThis.fetch;
  if (typeof fetchImpl !== 'function') {
    return { ok: false, url: normalized.url, error: 'fetch is not available in this Node.js version.' };
  }
  const timeoutMs = deps.timeoutMs ?? DETECT_TIMEOUT_MS;
  const maxBytes = deps.maxBytes ?? DETECT_MAX_BYTES;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  let current = normalized.url;
  try {
    for (let hop = 0; hop <= DETECT_MAX_REDIRECTS; hop++) {
      const res = await fetchImpl(current, {
        method: 'GET',
        redirect: 'manual',
        credentials: 'omit',
        signal: controller.signal,
        headers: {
          accept: 'text/html,application/xhtml+xml',
          'user-agent': 'stagepass-cli (site check)',
        },
      });
      if (res.status >= 300 && res.status < 400) {
        const location = res.headers.get('location');
        if (!location) {
          return { ok: false, url: current, error: `Redirect without Location (${res.status}).` };
        }
        const next = new URL(location, current);
        if (next.protocol !== 'https:') {
          return { ok: false, url: current, error: 'Redirect to a non-https URL was not followed.' };
        }
        if (next.username || next.password) {
          return { ok: false, url: current, error: 'Redirect URL contains credentials.' };
        }
        // INV-2: no port at all, :443 included (URL drops it, so check the raw Location).
        if (next.port || hasExplicitPort(location)) {
          return { ok: false, url: current, error: 'Redirect URL contains a port and was not followed.' };
        }
        current = next.toString();
        continue;
      }
      if (!res.ok) {
        return { ok: false, url: current, error: `Site answered HTTP ${res.status}.` };
      }
      const html = await readCapped(res, maxBytes);
      const parsed = parseStagepassScripts(html);
      return { ok: true, url: current, ...parsed, list: detectedModulesList(parsed) };
    }
    return { ok: false, url: current, error: `More than ${DETECT_MAX_REDIRECTS} redirects.` };
  } catch (err) {
    const aborted = controller.signal.aborted || (err && err.name === 'AbortError');
    return {
      ok: false,
      url: current,
      error: aborted
        ? `Site did not answer within ${Math.round(timeoutMs / 1000)} s.`
        : `Site not reachable: ${err instanceof Error ? err.message : String(err)}`,
    };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * One-line summary of a detection result.
 * @param {Awaited<ReturnType<typeof detectSite>>} det
 */
export function describeDetection(det) {
  if (!det.ok) return det.error;
  const loader = det.loader
    ? `loader @${det.loader.version} (${det.loader.cdn})`
    : 'no Stagepass loader';
  const mods =
    det.modules.length === 0
      ? 'no modules'
      : `modules ${det.modules.map((m) => `${m.id}@${m.version}`).join(', ')}`;
  return `${loader}, ${mods}`;
}
