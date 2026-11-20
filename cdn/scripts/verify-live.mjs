import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { contentTypeFor } from '../src/worker.js';

const ZONE_WARNING_HEADERS = [
  'content-security-policy',
  'content-security-policy-report-only',
  'cross-origin-opener-policy',
  'cross-origin-embedder-policy',
  'x-frame-options',
  'permissions-policy',
  'referrer-policy',
];

export function normalizeBase(base) {
  const url = new URL(base);
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new Error('base URL must be http or https');
  }
  if (url.username || url.password) throw new Error('base URL must not include credentials');
  if (url.pathname !== '/' && url.pathname !== '') {
    throw new Error('base URL must not include a path');
  }
  if (url.search || url.hash) throw new Error('base URL must not include a query or hash');
  return url.origin;
}

export function parseVerifyArgs(argv) {
  if (argv.length === 0) {
    throw new Error('usage: verify-live.mjs <base-url> [--sample N|--all] [--local path|none]');
  }
  const base = argv[0];
  let sample = 5;
  let all = false;
  let sawSample = false;
  let local;
  let localMode = 'auto';
  for (let i = 1; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--all') {
      all = true;
    } else if (arg === '--sample') {
      sawSample = true;
      sample = Number(argv[i + 1]);
      i += 1;
      if (!Number.isInteger(sample) || sample < 1) {
        throw new Error('--sample needs a positive integer');
      }
    } else if (arg === '--local') {
      local = argv[i + 1];
      i += 1;
      if (!local) throw new Error('--local needs a path or "none"');
      localMode = local === 'none' ? 'none' : 'path';
    } else {
      throw new Error(`unknown argument: ${arg}`);
    }
  }
  if (all && sawSample) throw new Error('pass either --all or --sample');
  return { base, all, sample, local, localMode };
}

export function listManifestFiles(manifest) {
  const files = [];
  const packages = manifest && Array.isArray(manifest.packages) ? manifest.packages : [];
  for (const pkg of packages) {
    if (!pkg || typeof pkg.package !== 'string' || typeof pkg.version !== 'string') continue;
    for (const file of pkg.files || []) {
      if (!file || typeof file.path !== 'string') continue;
      files.push({
        package: pkg.package,
        version: pkg.version,
        file: file.path,
        bytes: file.bytes,
        sha256: typeof file.sha256 === 'string' ? file.sha256.toLowerCase() : '',
        urlPath: `/${pkg.package}@${pkg.version}/${file.path}`,
      });
    }
  }
  files.sort((a, b) => a.urlPath.localeCompare(b.urlPath));
  return files;
}

export function encodedUrlPath(urlPath) {
  const at = urlPath.indexOf('@');
  if (at === -1) return urlPath;
  return `${urlPath.slice(0, at)}%40${urlPath.slice(at + 1)}`;
}

export function sampleEntries(entries, count) {
  if (!Array.isArray(entries) || entries.length === 0 || count <= 0) return [];
  if (count >= entries.length) return entries.slice();
  const picked = [];
  const used = new Set();
  const step = (entries.length - 1) / Math.max(count - 1, 1);
  for (let i = 0; i < count; i += 1) {
    let idx = Math.round(i * step);
    while (used.has(idx) && idx + 1 < entries.length) idx += 1;
    if (used.has(idx)) break;
    used.add(idx);
    picked.push(entries[idx]);
  }
  return picked;
}

export function manifestDrift(local, remote) {
  const left = listManifestFiles(local).map((file) => `${file.urlPath} ${file.bytes} ${file.sha256}`);
  const right = listManifestFiles(remote).map((file) => `${file.urlPath} ${file.bytes} ${file.sha256}`);
  const remoteSet = new Set(right);
  const localSet = new Set(left);
  const missingRemote = left.filter((line) => !remoteSet.has(line));
  const extraRemote = right.filter((line) => !localSet.has(line));
  return { missingRemote, extraRemote, ok: missingRemote.length === 0 && extraRemote.length === 0 };
}

function cacheOk(value, immutable) {
  const text = String(value || '').toLowerCase();
  if (immutable) {
    return text.includes('public') && text.includes('max-age=31536000') && text.includes('immutable');
  }
  return text.includes('max-age=60') || text.includes('no-store');
}

export function evaluateAssetHeaders(headers, { contentType, immutable = true } = {}) {
  const errors = [];
  const warnings = [];
  const read = (name) => (headers && typeof headers.get === 'function' ? headers.get(name) : null);
  if (read('access-control-allow-origin') !== '*') errors.push('access-control-allow-origin');
  if ((read('cross-origin-resource-policy') || '').toLowerCase() !== 'cross-origin') {
    errors.push('cross-origin-resource-policy');
  }
  if ((read('x-content-type-options') || '').toLowerCase() !== 'nosniff') {
    errors.push('x-content-type-options');
  }
  if (read('timing-allow-origin') !== '*') errors.push('timing-allow-origin');
  const actualType = (read('content-type') || '').toLowerCase();
  if (contentType && actualType !== contentType.toLowerCase()) errors.push('content-type');
  if (!cacheOk(read('cache-control'), immutable)) errors.push('cache-control');
  for (const name of ZONE_WARNING_HEADERS) {
    if (read(name)) warnings.push(name);
  }
  return { errors, warnings };
}

function defaultLocalManifest() {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'dist', 'manifest.json');
}

async function readOptionalJson(file) {
  try {
    return JSON.parse(await readFile(file, 'utf8'));
  } catch (error) {
    if (error && error.code === 'ENOENT') return null;
    throw error;
  }
}

async function request(url, init) {
  return fetch(url, {
    redirect: 'manual',
    signal: AbortSignal.timeout(20000),
    ...init,
  });
}

function sha256(bytes) {
  return createHash('sha256').update(Buffer.from(bytes)).digest('hex');
}

function pad(value, width) {
  const text = String(value);
  return text.length >= width ? text : text + ' '.repeat(width - text.length);
}

export async function verifyLive({ base, files, warnings }) {
  const failures = [];
  const rows = [];
  const warnSet = warnings;

  function noteWarnings(headerList) {
    for (const name of headerList) warnSet.add(name);
  }

  for (const file of files) {
    const encoded = encodedUrlPath(file.urlPath);
    const forms = [
      ['@', file.urlPath],
      ['%40', encoded],
    ];
    for (const [label, urlPath] of forms) {
      const url = base + urlPath;
      let response;
      try {
        response = await request(url);
      } catch (error) {
        failures.push(`${label} ${urlPath} ${error instanceof Error ? error.message : String(error)}`);
        rows.push([urlPath, label, 'ERR', 'request failed']);
        continue;
      }
      const status = response.status;
      if (status >= 300 && status < 400) {
        failures.push(`${label} ${urlPath} redirect ${status} ${response.headers.get('location') || ''}`);
        rows.push([urlPath, label, String(status), 'redirect']);
        continue;
      }
      if (status !== 200) {
        failures.push(`${label} ${urlPath} status ${status}`);
        rows.push([urlPath, label, String(status), 'status']);
        continue;
      }
      const body = Buffer.from(await response.arrayBuffer());
      const hash = sha256(body);
      const evaluated = evaluateAssetHeaders(response.headers, {
        contentType: contentTypeFor(file.file),
        immutable: true,
      });
      noteWarnings(evaluated.warnings);
      const problems = [];
      if (response.headers.get('location')) problems.push('location');
      if (hash !== file.sha256) problems.push('sha256');
      if (file.bytes != null && body.length !== file.bytes) problems.push('bytes');
      problems.push(...evaluated.errors);
      if (problems.length) {
        failures.push(`${label} ${urlPath} ${problems.join(',')}`);
        rows.push([urlPath, label, '200', problems.join(',')]);
      } else {
        const cache = response.headers.get('cf-cache-status') || '';
        rows.push([urlPath, label, '200', cache ? `ok ${cache}` : 'ok']);
      }
    }
  }

  const preflight = await request(base + '/', {
    method: 'OPTIONS',
    headers: {
      origin: 'https://example.webflow.io',
      'access-control-request-method': 'GET',
    },
  });
  if (preflight.status !== 204 || preflight.headers.get('access-control-allow-origin') !== '*') {
    failures.push(`OPTIONS / status ${preflight.status}`);
    rows.push(['/', 'OPTIONS', String(preflight.status), 'preflight']);
  } else {
    noteWarnings(evaluateAssetHeaders(preflight.headers, { immutable: false }).warnings);
    rows.push(['/', 'OPTIONS', '204', 'ok']);
  }

  const alias = await request(`${base}/loader@latest/loader.min.js`);
  const aliasBody = await alias.text();
  if (
    alias.status !== 404 ||
    (alias.status >= 300 && alias.status < 400) ||
    !aliasBody.includes('exact versions') ||
    !aliasBody.includes('@latest') ||
    alias.headers.get('access-control-allow-origin') !== '*'
  ) {
    failures.push(`alias status ${alias.status}`);
    rows.push(['/loader@latest/loader.min.js', '@', String(alias.status), 'alias']);
  } else {
    noteWarnings(evaluateAssetHeaders(alias.headers, {
      contentType: 'text/plain; charset=utf-8',
      immutable: false,
    }).warnings);
    rows.push(['/loader@latest/loader.min.js', '@', '404', 'ok']);
  }

  const post = await request(`${base}/manifest.json`, { method: 'POST' });
  const allow = post.headers.get('allow') || '';
  if (post.status !== 405 || !allow.includes('GET') || !allow.includes('HEAD') || !allow.includes('OPTIONS')) {
    failures.push(`POST status ${post.status} allow ${allow}`);
    rows.push(['/manifest.json', 'POST', String(post.status), 'method']);
  } else if (post.headers.get('access-control-allow-origin') !== '*') {
    failures.push('POST missing ACAO');
    rows.push(['/manifest.json', 'POST', '405', 'acao']);
  } else {
    rows.push(['/manifest.json', 'POST', '405', 'ok']);
  }

  return { failures, rows };
}

function printTable(rows, warnings, failures) {
  const header = ['path', 'form', 'status', 'result'];
  const widths = header.map((name, index) => {
    let width = name.length;
    for (const row of rows) width = Math.max(width, String(row[index]).length);
    return Math.min(width, 72);
  });
  const line = (row) => row.map((cell, index) => pad(String(cell).slice(0, widths[index]), widths[index])).join('  ');
  process.stdout.write(`${line(header)}\n`);
  for (const row of rows) process.stdout.write(`${line(row)}\n`);
  if (warnings.size) {
    process.stdout.write(`WARNING zone-injected headers: ${[...warnings].sort().join(', ')}\n`);
  }
  process.stdout.write(`failures: ${failures.length}\n`);
}

function isDirectRun() {
  const entry = process.argv[1];
  if (!entry) return false;
  return pathToFileURL(path.resolve(entry)).href === import.meta.url;
}

async function main() {
  const args = parseVerifyArgs(process.argv.slice(2));
  const base = normalizeBase(args.base);
  const remoteResponse = await request(`${base}/manifest.json`);
  if (remoteResponse.status !== 200) {
    console.error(`GET /manifest.json status ${remoteResponse.status}`);
    process.exit(1);
  }
  const remote = await remoteResponse.json();
  let localFile = null;
  if (args.localMode === 'path') localFile = path.resolve(args.local);
  if (args.localMode === 'auto') localFile = defaultLocalManifest();
  if (localFile && args.localMode !== 'none') {
    const local = await readOptionalJson(localFile);
    if (!local && args.localMode === 'path') {
      console.error(`local manifest not found: ${localFile}`);
      process.exit(1);
    }
    if (local) {
      const drift = manifestDrift(local, remote);
      if (!drift.ok) {
        console.error(`local manifest does not match ${base}/manifest.json`);
        for (const line of drift.missingRemote.slice(0, 8)) console.error(`  missing on remote ${line}`);
        for (const line of drift.extraRemote.slice(0, 8)) console.error(`  extra on remote ${line}`);
        process.exit(1);
      }
      process.stdout.write(`local manifest matches ${localFile}\n`);
    } else {
      process.stdout.write('local manifest not present; checking the deployed manifest only\n');
    }
  }
  const allFiles = listManifestFiles(remote);
  if (allFiles.length === 0) {
    console.error('manifest has no files');
    process.exit(1);
  }
  const files = args.all ? allFiles : sampleEntries(allFiles, args.sample);
  process.stdout.write(`checking ${files.length} of ${allFiles.length} files at ${base}\n`);
  const warnings = new Set();
  const { failures, rows } = await verifyLive({ base, files, warnings });
  printTable(rows, warnings, failures);
  if (failures.length) {
    for (const failure of failures) console.error(failure);
    process.exit(1);
  }
}

if (isDirectRun()) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.stack || error.message : String(error));
    process.exit(1);
  });
}
