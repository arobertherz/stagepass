import {
  ALIAS_BODY,
  BAD_GATEWAY_BODY,
  IMMUTABLE_CACHE,
  MAJOR_ALIAS_CACHE,
  METHOD_BODY,
  NOT_FOUND_BODY,
  ROOT_BODY,
  SHORT_CACHE,
} from './policy.js';
import {
  aliasLocation,
  fileSet,
  recordFor,
  resolveLatestVersion,
  resolveMajorVersion,
} from './catalog.js';
import { isExactSemver, majorAliasNumber } from './semver.js';
import {
  countryCode,
  embeddingHost,
  isInternal,
  parseInternalHosts,
  usagePoint,
} from './usage.js';

const PACKAGES = new Set(['loader', 'modules']);
const ASSET_ORIGIN = 'https://assets.local';
const PASSTHROUGH_HEADERS = ['etag', 'content-length', 'last-modified'];
// Percent-encoded slash, backslash, dot, or NUL. Hex letters are case-insensitive.
const DANGEROUS_PERCENT = /%(?:2f|5c|2e|00)/i;
const FILE_SEGMENT = /^[A-Za-z0-9._+-]+$/;

const CONTENT_TYPES = new Map([
  ['js', 'text/javascript; charset=utf-8'],
  ['mjs', 'text/javascript; charset=utf-8'],
  ['cjs', 'text/javascript; charset=utf-8'],
  ['json', 'application/json; charset=utf-8'],
  ['map', 'application/json; charset=utf-8'],
  ['css', 'text/css; charset=utf-8'],
  ['html', 'text/html; charset=utf-8'],
  ['svg', 'image/svg+xml'],
  ['txt', 'text/plain; charset=utf-8'],
  ['md', 'text/plain; charset=utf-8'],
  ['ts', 'text/plain; charset=utf-8'],
  ['wasm', 'application/wasm'],
  ['png', 'image/png'],
  ['jpg', 'image/jpeg'],
  ['jpeg', 'image/jpeg'],
  ['gif', 'image/gif'],
  ['webp', 'image/webp'],
  ['woff', 'font/woff'],
  ['woff2', 'font/woff2'],
]);

const TEXT_EXTENSIONS = new Set(['tsx', 'mts', 'cts']);

export function rawPathname(input) {
  if (typeof input !== 'string' || input.length === 0) return '/';
  let value = input;
  const hash = value.indexOf('#');
  if (hash !== -1) value = value.slice(0, hash);
  let path = value;
  if (!path.startsWith('/')) {
    const match = /^[a-z][a-z0-9+.-]*:\/\/[^/?#]*([^?#]*)/i.exec(path);
    if (!match) return '/';
    path = match[1] || '/';
  }
  const query = path.indexOf('?');
  if (query !== -1) path = path.slice(0, query);
  return path === '' ? '/' : path;
}

function parsePackageSegment(segment) {
  const lower = segment.toLowerCase();
  const pct = lower.indexOf('%40');
  const at = segment.indexOf('@');
  if (pct !== -1 && at !== -1) return null;
  if (pct !== -1) {
    if (lower.indexOf('%40', pct + 3) !== -1) return null;
    return {
      packageName: segment.slice(0, pct),
      version: segment.slice(pct + 3),
    };
  }
  if (at !== -1) {
    if (segment.indexOf('@', at + 1) !== -1) return null;
    return {
      packageName: segment.slice(0, at),
      version: segment.slice(at + 1),
    };
  }
  return null;
}

function encodedFromLiteral(literalPath) {
  return `/${literalPath
    .split('/')
    .filter((segment) => segment.length > 0)
    .map((segment) => encodeURIComponent(segment))
    .join('/')}`;
}

// Classify a raw path. `%40` is accepted in any hex case. Other percent-encoding is rejected.
export function classifyPath(rawPath) {
  if (typeof rawPath !== 'string' || rawPath.length === 0 || rawPath.length > 2048) {
    return { kind: 'invalid' };
  }
  if (rawPath === '/') return { kind: 'root' };
  if (!rawPath.startsWith('/')) return { kind: 'invalid' };
  if (
    rawPath.includes('\\') ||
    rawPath.includes('\0') ||
    rawPath.includes('..') ||
    DANGEROUS_PERCENT.test(rawPath)
  ) {
    return { kind: 'invalid' };
  }
  const withoutAt = rawPath.replace(/%40/i, '');
  if (withoutAt.includes('%')) return { kind: 'invalid' };

  const parts = rawPath.split('/');
  if (parts[0] !== '') return { kind: 'invalid' };
  let segments = parts.slice(1);
  if (segments.length === 0 || segments.length > 32) return { kind: 'invalid' };
  // /loader@2.5.0/ is the short URL. /loader@2.5.0/loader.min.js/ stays invalid.
  if (segments.length === 2 && segments[1] === '' && segments[0] !== '') {
    segments = [segments[0]];
  }
  if (segments.some((segment) => segment.length === 0 || segment === '.')) {
    return { kind: 'invalid' };
  }
  if (segments.length === 1 && segments[0] === 'manifest.json') {
    return {
      kind: 'manifest',
      literalPath: '/manifest.json',
      encodedPath: '/manifest.json',
    };
  }

  const parsed = parsePackageSegment(segments[0]);
  if (!parsed) {
    if (segments.length === 1 && PACKAGES.has(segments[0])) {
      return { kind: 'latest', packageName: segments[0], spec: '', file: null };
    }
    return { kind: 'invalid' };
  }
  if (!PACKAGES.has(parsed.packageName) || parsed.version.length === 0) {
    return { kind: 'invalid' };
  }
  if (parsed.version === 'latest') {
    if (segments.length === 1) {
      return { kind: 'latest', packageName: parsed.packageName, spec: 'latest', file: null };
    }
    for (const segment of segments.slice(1)) {
      if (!FILE_SEGMENT.test(segment)) return { kind: 'invalid' };
    }
    return {
      kind: 'latest',
      packageName: parsed.packageName,
      spec: 'latest',
      file: segments.slice(1).join('/'),
    };
  }
  const major = isExactSemver(parsed.version) ? null : majorAliasNumber(parsed.version);
  if (!isExactSemver(parsed.version) && major === null) {
    let file = '';
    if (segments.length > 1 && segments.slice(1).every((segment) => FILE_SEGMENT.test(segment))) {
      file = segments.slice(1).join('/');
    }
    return {
      kind: 'alias',
      packageName: parsed.packageName,
      version: parsed.version,
      spec: parsed.version,
      file,
    };
  }
    if (segments.length < 2) {
      if (major !== null) {
        return {
          kind: 'major',
          packageName: parsed.packageName,
          major,
          spec: parsed.version,
          file: null,
        };
      }
    return {
      kind: 'entry',
      packageName: parsed.packageName,
      version: parsed.version,
    };
  }
  for (const segment of segments.slice(1)) {
    if (!FILE_SEGMENT.test(segment)) return { kind: 'invalid' };
  }
  const file = segments.slice(1).join('/');
  if (major !== null) {
    return {
      kind: 'major',
      packageName: parsed.packageName,
      major,
      spec: parsed.version,
      file,
    };
  }

  const literalSegments = [`${parsed.packageName}@${parsed.version}`, ...segments.slice(1)];
  const literalPath = `/${literalSegments.join('/')}`;
  return {
    kind: 'asset',
    packageName: parsed.packageName,
    version: parsed.version,
    file,
    literalPath,
    encodedPath: encodedFromLiteral(literalPath),
  };
}

export function contentTypeFor(filePath) {
  const base = String(filePath).split('/').pop() || '';
  if (base.endsWith('.d.ts')) return 'text/plain; charset=utf-8';
  const dot = base.lastIndexOf('.');
  const ext = dot === -1 ? '' : base.slice(dot + 1).toLowerCase();
  if (CONTENT_TYPES.has(ext)) return CONTENT_TYPES.get(ext);
  if (TEXT_EXTENSIONS.has(ext)) return 'text/plain; charset=utf-8';
  return 'application/octet-stream';
}

export function buildHeaders({
  contentType,
  cacheControl,
  allow,
  preflight = false,
  assetHeaders,
}) {
  const headers = new Headers();
  headers.set('access-control-allow-origin', '*');
  headers.set('cross-origin-resource-policy', 'cross-origin');
  headers.set('x-content-type-options', 'nosniff');
  headers.set('timing-allow-origin', '*');
  headers.set('cache-control', cacheControl);
  if (contentType) headers.set('content-type', contentType);
  if (allow) headers.set('allow', allow);
  if (preflight) {
    headers.set('access-control-allow-methods', 'GET, HEAD, OPTIONS');
    headers.set('access-control-allow-headers', '*');
    headers.set('access-control-max-age', '86400');
  }
  if (assetHeaders) {
    for (const name of PASSTHROUGH_HEADERS) {
      const value = assetHeaders.get(name);
      if (value) headers.set(name, value);
    }
  }
  return headers;
}

export function sameAssetLocation(location, spec) {
  if (typeof location !== 'string') return null;
  const trimmed = location.trim();
  if (trimmed.length === 0 || trimmed.length > 2048) return null;
  if (/[\u0000-\u0020]/.test(trimmed) || trimmed.includes('\\') || trimmed.startsWith('//')) {
    return null;
  }
  let path;
  if (trimmed.startsWith('/')) {
    path = trimmed.split('#')[0].split('?')[0];
  } else {
    try {
      // Validate the absolute URL, then keep the raw path so `%40` is not decoded.
      // The URL constructor is only a syntax check here.
      void new URL(trimmed);
    } catch {
      return null;
    }
    path = rawPathname(trimmed);
  }
  if (path !== spec.encodedPath && path !== spec.literalPath) return null;
  return path;
}

function textResponse(status, body, cacheControl, contentType, method, extra) {
  const bytes = new TextEncoder().encode(body);
  const headers = buildHeaders({
    contentType,
    cacheControl,
    allow: extra && extra.allow,
    preflight: extra && extra.preflight,
  });
  if (!extra || !extra.preflight) {
    headers.set('content-length', String(bytes.byteLength));
  }
  return new Response(method === 'HEAD' ? null : bytes, { status, headers });
}

function preflight() {
  return new Response(null, {
    status: 204,
    headers: buildHeaders({
      cacheControl: SHORT_CACHE,
      preflight: true,
    }),
  });
}

function methodNotAllowed(method) {
  return textResponse(405, METHOD_BODY, SHORT_CACHE, 'text/plain; charset=utf-8', method, {
    allow: 'GET, HEAD, OPTIONS',
  });
}

function notFound(method, body) {
  return textResponse(404, body, SHORT_CACHE, 'text/plain; charset=utf-8', method);
}

function badGateway(method) {
  return textResponse(502, BAD_GATEWAY_BODY, SHORT_CACHE, 'text/plain; charset=utf-8', method);
}

function assetRequest(pathname, method, request) {
  const headers = new Headers();
  const ifNoneMatch = request.headers.get('if-none-match');
  if (ifNoneMatch) headers.set('if-none-match', ifNoneMatch);
  const ifModifiedSince = request.headers.get('if-modified-since');
  if (ifModifiedSince) headers.set('if-modified-since', ifModifiedSince);
  // Pass the path through as a string. Do not assign `pathname` on a URL object:
  // that re-encodes `%` and turns `%40` into `%2540`.
  return new Request(ASSET_ORIGIN + pathname, { method, headers });
}

function isRedirect(status) {
  return status >= 300 && status < 400 && status !== 304;
}

async function discardBody(response) {
  if (!response || !response.body) return;
  try {
    await response.body.cancel();
  } catch {
    // Already consumed or not cancellable.
  }
}

async function fetchAsset(env, request, pathname, method) {
  return env.ASSETS.fetch(assetRequest(pathname, method, request));
}

// The asset server stores `loader@2.5.0/...` and answers 200 when the request
// pathname is the encodeURIComponent form (`loader%402.5.0/...`). A literal `@`
// pathname is a 307 to that form. Ask for the encoded form first. If the
// binding still returns a redirect, follow that Location once inside the
// worker. A second redirect becomes 502. An exact-version client response is
// never a 3xx. Major aliases are a separate 302 built in serveMajor.
async function loadAsset(env, request, spec, method) {
  if (!env || !env.ASSETS || typeof env.ASSETS.fetch !== 'function') {
    return { error: 502 };
  }
  let response;
  try {
    response = await fetchAsset(env, request, spec.encodedPath, method);
  } catch (error) {
    console.error(JSON.stringify({
      message: 'asset fetch failed',
      path: spec.literalPath,
      error: error instanceof Error ? error.message : String(error),
    }));
    return { error: 502 };
  }
  if (isRedirect(response.status)) {
    const next = sameAssetLocation(response.headers.get('location'), spec);
    await discardBody(response);
    if (!next) {
      console.error(JSON.stringify({
        message: 'asset redirect was not the canonical file',
        path: spec.literalPath,
      }));
      return { error: 502 };
    }
    try {
      response = await fetchAsset(env, request, next, method);
    } catch (error) {
      console.error(JSON.stringify({
        message: 'asset redirect follow failed',
        path: spec.literalPath,
        error: error instanceof Error ? error.message : String(error),
      }));
      return { error: 502 };
    }
  }
  if (isRedirect(response.status)) {
    await discardBody(response);
    console.error(JSON.stringify({
      message: 'asset server returned a second redirect',
      path: spec.literalPath,
      status: response.status,
    }));
    return { error: 502 };
  }
  return { response };
}

// One parsed manifest per ASSETS binding. A deploy starts a new isolate, so
// this cache does not outlive the asset set it describes. Failures are not
// cached. The value is the parsed object, not the Response.
const manifestCache = new WeakMap();

function manifestFailure(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}

async function readManifest(binding) {
  let response;
  try {
    response = await binding.fetch(new Request(`${ASSET_ORIGIN}/manifest.json`, { method: 'GET' }));
  } catch (error) {
    console.error(JSON.stringify({
      message: 'manifest fetch failed',
      error: error instanceof Error ? error.message : String(error),
    }));
    throw manifestFailure(502, 'manifest fetch failed');
  }
  if (response.status !== 200) {
    await discardBody(response);
    console.error(JSON.stringify({
      message: 'manifest status',
      status: response.status,
    }));
    throw manifestFailure(response.status === 404 ? 404 : 502, 'manifest status');
  }
  try {
    return await response.json();
  } catch (error) {
    console.error(JSON.stringify({
      message: 'manifest json',
      error: error instanceof Error ? error.message : String(error),
    }));
    throw manifestFailure(502, 'manifest json');
  }
}

function loadManifest(env) {
  const binding = env && env.ASSETS;
  if (!binding || typeof binding.fetch !== 'function') {
    return Promise.resolve({ error: 502 });
  }
  const existing = manifestCache.get(binding);
  if (existing) return existing;
  const pending = readManifest(binding).then(
    (manifest) => ({ manifest }),
    (error) => {
      if (manifestCache.get(binding) === pending) manifestCache.delete(binding);
      return { error: error && error.status === 404 ? 404 : 502 };
    },
  );
  manifestCache.set(binding, pending);
  return pending;
}

function assetSpec(packageName, version, file) {
  const literalPath = `/${packageName}@${version}/${file}`;
  return {
    literalPath,
    encodedPath: encodedFromLiteral(literalPath),
    file,
  };
}

function redirectResponse(location) {
  const headers = buildHeaders({ cacheControl: MAJOR_ALIAS_CACHE });
  headers.set('location', location);
  headers.set('content-length', '0');
  return new Response(null, { status: 302, headers });
}

// Location is `/pkg@version/file`. Keep the version and the file name only.
function noteRedirect(usage, location) {
  if (!usage || typeof location !== 'string' || !location.startsWith('/')) return;
  const slash = location.indexOf('/', 1);
  const at = location.indexOf('@');
  if (slash === -1 || at < 1 || at > slash) return;
  const version = location.slice(at + 1, slash);
  const file = location.slice(slash + 1);
  if (!version || !file || file.includes('?') || file.includes('#') || file.includes('\\')) return;
  usage.resolvedVersion = version;
  usage.file = file;
}

async function serveMajor(env, route, method, usage) {
  const loaded = await loadManifest(env);
  if (loaded.error === 502) return badGateway(method);
  if (!loaded.manifest) return notFound(method, NOT_FOUND_BODY);
  const version = resolveMajorVersion(loaded.manifest, route.packageName, route.major);
  if (!version) return notFound(method, NOT_FOUND_BODY);
  const location = aliasLocation(loaded.manifest, route.packageName, version, route.file);
  if (!location) return notFound(method, NOT_FOUND_BODY);
  noteRedirect(usage, location);
  return redirectResponse(location);
}

async function serveLatest(env, route, method, usage) {
  const loaded = await loadManifest(env);
  if (loaded.error === 502) return badGateway(method);
  if (!loaded.manifest) return notFound(method, NOT_FOUND_BODY);
  const version = resolveLatestVersion(loaded.manifest, route.packageName);
  if (!version) return notFound(method, NOT_FOUND_BODY);
  const location = aliasLocation(loaded.manifest, route.packageName, version, route.file);
  if (!location) return notFound(method, NOT_FOUND_BODY);
  noteRedirect(usage, location);
  return redirectResponse(location);
}

async function serveEntry(env, request, route, method, usage) {
  const loaded = await loadManifest(env);
  if (loaded.error === 502) return badGateway(method);
  if (!loaded.manifest) return notFound(method, NOT_FOUND_BODY);
  const record = recordFor(loaded.manifest, route.packageName, route.version);
  if (!record || typeof record.entry !== 'string' || !fileSet(record).has(record.entry)) {
    return notFound(method, NOT_FOUND_BODY);
  }
  if (usage) usage.file = record.entry;
  return serveSpec(
    env,
    request,
    assetSpec(route.packageName, route.version, record.entry),
    method,
    contentTypeFor(record.entry),
    IMMUTABLE_CACHE,
  );
}

function assetHttpResponse(assetResponse, method, contentType, cacheControl) {
  const headers = buildHeaders({
    contentType,
    cacheControl,
    assetHeaders: assetResponse.headers,
  });
  if (method === 'HEAD' || assetResponse.status === 304) {
    return new Response(null, { status: assetResponse.status, headers });
  }
  return new Response(assetResponse.body, { status: assetResponse.status, headers });
}

async function serveSpec(env, request, spec, method, contentType, cacheControl) {
  const loaded = await loadAsset(env, request, spec, method);
  if (loaded.error) return badGateway(method);
  const assetResponse = loaded.response;
  if (assetResponse.status === 404) {
    await discardBody(assetResponse);
    return notFound(method, NOT_FOUND_BODY);
  }
  if (assetResponse.status !== 200 && assetResponse.status !== 304) {
    await discardBody(assetResponse);
    console.error(JSON.stringify({
      message: 'unexpected asset status',
      path: spec.literalPath,
      status: assetResponse.status,
    }));
    return badGateway(method);
  }
  return assetHttpResponse(assetResponse, method, contentType, cacheControl);
}

function emptyUsage(pkg) {
  return {
    pkg,
    resolvedVersion: '',
    specKind: 'none',
    spec: '',
    file: '',
  };
}

function usageForRoute(route) {
  if (!route || route.kind === 'invalid') return emptyUsage('unknown');
  if (route.kind === 'root' || route.kind === 'manifest') return emptyUsage('');
  if (route.kind === 'asset' || route.kind === 'entry') {
    return {
      pkg: route.packageName,
      resolvedVersion: '',
      specKind: 'exact',
      spec: route.version,
      file: route.kind === 'asset' ? route.file : '',
    };
  }
  if (route.kind === 'major') {
    return {
      pkg: route.packageName,
      resolvedVersion: '',
      specKind: 'range',
      spec: route.spec || '',
      file: route.file || '',
    };
  }
  if (route.kind === 'latest') {
    return {
      pkg: route.packageName,
      resolvedVersion: '',
      specKind: 'latest',
      spec: route.spec || '',
      file: route.file || '',
    };
  }
  if (route.kind === 'alias') {
    return {
      pkg: route.packageName,
      resolvedVersion: '',
      specKind: 'none',
      spec: route.spec || route.version || '',
      file: route.file || '',
    };
  }
  return emptyUsage('unknown');
}

// Response plus the usage fields for that request. `handleRequest` returns
// only the response so existing callers stay unchanged.
export async function describeRequest(request, env) {
  const method = String(request.method || 'GET').toUpperCase();
  const route = classifyPath(rawPathname(request.url));
  const usage = usageForRoute(route);
  let response;
  if (method === 'OPTIONS') {
    response = preflight();
  } else if (method !== 'GET' && method !== 'HEAD') {
    response = methodNotAllowed(method);
  } else if (route.kind === 'root') {
    response = textResponse(200, ROOT_BODY, SHORT_CACHE, 'text/plain; charset=utf-8', method);
  } else if (route.kind === 'major') {
    response = await serveMajor(env, route, method, usage);
  } else if (route.kind === 'latest') {
    response = await serveLatest(env, route, method, usage);
  } else if (route.kind === 'entry') {
    response = await serveEntry(env, request, route, method, usage);
  } else if (route.kind === 'alias') {
    response = notFound(method, ALIAS_BODY);
  } else if (route.kind === 'invalid') {
    response = notFound(method, NOT_FOUND_BODY);
  } else if (route.kind === 'manifest') {
    response = await serveSpec(
      env,
      request,
      route,
      method,
      'application/json; charset=utf-8',
      SHORT_CACHE,
    );
  } else {
    response = await serveSpec(
      env,
      request,
      route,
      method,
      contentTypeFor(route.file),
      IMMUTABLE_CACHE,
    );
  }
  if (
    (route.kind === 'asset' || route.kind === 'entry') &&
    response &&
    (response.status === 200 || response.status === 304)
  ) {
    usage.resolvedVersion = route.version;
  }
  return { response, usage };
}

export async function handleRequest(request, env) {
  const described = await describeRequest(request, env);
  return described.response;
}

// Recording is best-effort. A missing binding, a missing ctx, or a throwing
// writeDataPoint must not change the response.
export function recordUsage(request, env, ctx, usage, status) {
  try {
    if (!env || !env.USAGE || typeof env.USAGE.writeDataPoint !== 'function') return;
    if (!ctx || typeof ctx.waitUntil !== 'function') return;
    const host = embeddingHost(request);
    const point = usagePoint({
      host,
      internal: isInternal(host, parseInternalHosts(env.INTERNAL_HOSTS)),
      env: typeof env.CDN_ENV === 'string' ? env.CDN_ENV : '',
      pkg: usage && usage.pkg,
      resolvedVersion: usage && usage.resolvedVersion,
      specKind: usage && usage.specKind,
      spec: usage && usage.spec,
      file: usage && usage.file,
      country: countryCode(request),
      status,
    });
    const dataset = env.USAGE;
    ctx.waitUntil(Promise.resolve().then(() => {
      dataset.writeDataPoint(point);
    }).catch(() => {}));
  } catch {
    // Never fail the response because a usage write failed.
  }
}

export default {
  async fetch(request, env, ctx) {
    const described = await describeRequest(request, env);
    recordUsage(request, env, ctx, described.usage, described.response.status);
    return described.response;
  },
};
