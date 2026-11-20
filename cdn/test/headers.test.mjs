import assert from 'node:assert/strict';
import test from 'node:test';
import {
  ALIAS_BODY,
  FORBIDDEN_HEADERS,
  IMMUTABLE_CACHE,
  NOT_FOUND_BODY,
  SHORT_CACHE,
} from '../src/policy.js';
import { buildHeaders, contentTypeFor, handleRequest } from '../src/worker.js';

function entries(headers) {
  return [...headers.entries()]
    .map(([name, value]) => [name.toLowerCase(), value])
    .sort((a, b) => a[0].localeCompare(b[0]));
}

test('content types for dist files', () => {
  assert.equal(contentTypeFor('loader.min.js'), 'text/javascript; charset=utf-8');
  assert.equal(contentTypeFor('mod.mjs'), 'text/javascript; charset=utf-8');
  assert.equal(contentTypeFor('manifest.json'), 'application/json; charset=utf-8');
  assert.equal(contentTypeFor('loader.min.js.map'), 'application/json; charset=utf-8');
  assert.equal(contentTypeFor('global.d.ts'), 'text/plain; charset=utf-8');
  assert.equal(contentTypeFor('notes.txt'), 'text/plain; charset=utf-8');
  assert.equal(contentTypeFor('blob.bin'), 'application/octet-stream');
});

test('versioned header set copies only etag, length, and last-modified', () => {
  const assetHeaders = new Headers({
    etag: '"abc"',
    'content-length': '10',
    'last-modified': 'Fri, 20 Nov 2026 00:00:00 GMT',
    'content-type': 'application/octet-stream',
    'content-security-policy': "default-src 'self'",
    'cross-origin-opener-policy': 'same-origin',
    'cross-origin-embedder-policy': 'require-corp',
    'x-frame-options': 'DENY',
    'permissions-policy': 'camera=()',
    'referrer-policy': 'no-referrer',
    'x-extra': 'nope',
  });
  const headers = buildHeaders({
    contentType: 'text/javascript; charset=utf-8',
    cacheControl: IMMUTABLE_CACHE,
    assetHeaders,
  });
  assert.deepEqual(entries(headers), [
    ['access-control-allow-origin', '*'],
    ['cache-control', IMMUTABLE_CACHE],
    ['content-length', '10'],
    ['content-type', 'text/javascript; charset=utf-8'],
    ['cross-origin-resource-policy', 'cross-origin'],
    ['etag', '"abc"'],
    ['last-modified', 'Fri, 20 Nov 2026 00:00:00 GMT'],
    ['timing-allow-origin', '*'],
    ['x-content-type-options', 'nosniff'],
  ]);
  for (const name of FORBIDDEN_HEADERS) {
    assert.equal(headers.get(name), null, name);
  }
});

test('404 and 405 responses from the worker carry CORS and a short cache', async () => {
  const missing = await handleRequest(new Request('https://cdn.example/nope'), {});
  assert.equal(missing.status, 404);
  assert.equal(await missing.text(), NOT_FOUND_BODY);
  assert.deepEqual(entries(missing.headers), [
    ['access-control-allow-origin', '*'],
    ['cache-control', SHORT_CACHE],
    ['content-length', String(new TextEncoder().encode(NOT_FOUND_BODY).byteLength)],
    ['content-type', 'text/plain; charset=utf-8'],
    ['cross-origin-resource-policy', 'cross-origin'],
    ['timing-allow-origin', '*'],
    ['x-content-type-options', 'nosniff'],
  ]);
  for (const name of FORBIDDEN_HEADERS) assert.equal(missing.headers.get(name), null);

  const alias = await handleRequest(new Request('https://cdn.example/loader@next/loader.min.js'), {});
  assert.equal(alias.status, 404);
  assert.equal(await alias.text(), ALIAS_BODY);
  assert.match(alias.headers.get('cache-control'), /max-age=60/);

  const denied = await handleRequest(
    new Request('https://cdn.example/loader@2.5.0/loader.min.js', { method: 'POST' }),
    {},
  );
  assert.equal(denied.status, 405);
  assert.equal(denied.headers.get('allow'), 'GET, HEAD, OPTIONS');
  assert.equal(denied.headers.get('access-control-allow-origin'), '*');
  assert.equal(denied.headers.get('cache-control'), SHORT_CACHE);
  for (const name of FORBIDDEN_HEADERS) assert.equal(denied.headers.get(name), null);
});
