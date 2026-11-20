import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import {
  ALIAS_BODY,
  IMMUTABLE_CACHE,
  MAJOR_ALIAS_CACHE,
  NOT_FOUND_BODY,
  ROOT_BODY,
  SHORT_CACHE,
} from '../src/policy.js';
import { handleRequest } from '../src/worker.js';

function fakeRequest(url, method = 'GET', headers) {
  return { url, method, headers: new Headers(headers) };
}

test('worker source stays free of Node imports', async () => {
  for (const file of ['../src/worker.js', '../src/semver.js', '../src/policy.js', '../src/catalog.js']) {
    const source = await readFile(new URL(file, import.meta.url), 'utf8');
    assert.equal(source.includes('node:'), false, file);
  }
});

test('GET and HEAD serve an asset and drop asset-server headers', async () => {
  const calls = [];
  const env = {
    ASSETS: {
      async fetch(request) {
        calls.push({ url: request.url, method: request.method });
        return new Response('console.log(1)\n', {
          status: 200,
          headers: {
            etag: '"abc"',
            'content-length': '15',
            'content-type': 'application/octet-stream',
            'content-security-policy': "default-src 'self'",
            'x-frame-options': 'DENY',
            'x-asset-extra': 'strip',
          },
        });
      },
    },
  };
  const response = await handleRequest(
    fakeRequest('https://cdn.example/loader%402.5.0/loader.min.js'),
    env,
  );
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('location'), null);
  assert.equal(await response.text(), 'console.log(1)\n');
  assert.equal(response.headers.get('content-type'), 'text/javascript; charset=utf-8');
  assert.equal(response.headers.get('cache-control'), IMMUTABLE_CACHE);
  assert.equal(response.headers.get('etag'), '"abc"');
  assert.equal(response.headers.get('access-control-allow-origin'), '*');
  assert.equal(response.headers.get('cross-origin-resource-policy'), 'cross-origin');
  assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(response.headers.get('timing-allow-origin'), '*');
  assert.equal(response.headers.get('content-security-policy'), null);
  assert.equal(response.headers.get('x-frame-options'), null);
  assert.equal(response.headers.get('x-asset-extra'), null);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].method, 'GET');
  // Node's Request serializer may decode %40 back to @. Either form is this file.
  // %2540 would mean the worker double-encoded the path.
  assert.match(calls[0].url, /\/loader(?:@|%40)2\.5\.0\/loader\.min\.js$/);
  assert.equal(calls[0].url.includes('%2540'), false);

  const head = await handleRequest(
    new Request('https://cdn.example/loader@2.5.0/loader.min.js', { method: 'HEAD' }),
    env,
  );
  assert.equal(head.status, 200);
  assert.equal(await head.text(), '');
  assert.equal(head.headers.get('content-type'), 'text/javascript; charset=utf-8');
  assert.equal(calls.at(-1).method, 'HEAD');
});

test('a 307 from ASSETS is followed once and never forwarded', async () => {
  let calls = 0;
  const env = {
    ASSETS: {
      async fetch() {
        calls += 1;
        if (calls === 1) {
          return new Response('redirect', {
            status: 307,
            headers: {
              location: '/loader%402.5.0/loader.min.js',
              'cache-control': IMMUTABLE_CACHE,
              'x-asset-extra': 'strip',
            },
          });
        }
        return new Response('ok', {
          status: 200,
          headers: { etag: '"abc"', 'content-length': '2', 'x-asset-extra': 'strip' },
        });
      },
    },
  };
  const response = await handleRequest(
    new Request('https://cdn.example/loader@2.5.0/loader.min.js'),
    env,
  );
  assert.equal(calls, 2);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('location'), null);
  assert.equal(await response.text(), 'ok');
  assert.equal(response.headers.get('x-asset-extra'), null);
  assert.equal(response.headers.get('etag'), '"abc"');
  assert.equal(response.headers.get('cache-control'), IMMUTABLE_CACHE);
});

test('a second asset redirect becomes a 502 with no Location', async () => {
  let calls = 0;
  const env = {
    ASSETS: {
      async fetch() {
        calls += 1;
        return new Response(null, {
          status: 307,
          headers: { location: '/loader%402.5.0/loader.min.js' },
        });
      },
    },
  };
  const response = await handleRequest(
    new Request('https://cdn.example/loader@2.5.0/loader.min.js'),
    env,
  );
  assert.equal(calls, 2);
  assert.equal(response.status, 502);
  assert.equal(response.headers.get('location'), null);
  assert.equal(response.headers.get('access-control-allow-origin'), '*');
  assert.equal(response.headers.get('cache-control'), SHORT_CACHE);
});

test('an asset redirect to a different path is not followed', async () => {
  let calls = 0;
  const env = {
    ASSETS: {
      async fetch() {
        calls += 1;
        return new Response(null, {
          status: 302,
          headers: { location: 'https://evil.example/modules@2.2.2/cookies.min.js' },
        });
      },
    },
  };
  const response = await handleRequest(
    new Request('https://cdn.example/loader@2.5.0/loader.min.js'),
    env,
  );
  assert.equal(calls, 1);
  assert.equal(response.status, 502);
  assert.equal(response.headers.get('location'), null);
});

test('If-None-Match is forwarded and a 304 keeps the rebuilt headers', async () => {
  const env = {
    ASSETS: {
      async fetch(request) {
        assert.equal(request.headers.get('if-none-match'), '"abc"');
        assert.equal(request.headers.get('if-modified-since'), 'Fri, 20 Nov 2026 00:00:00 GMT');
        assert.equal(request.headers.get('authorization'), null);
        assert.equal(request.headers.get('cookie'), null);
        assert.equal(request.headers.get('accept-encoding'), null);
        return new Response(null, {
          status: 304,
          headers: {
            etag: '"abc"',
            'content-security-policy': "default-src 'self'",
          },
        });
      },
    },
  };
  const response = await handleRequest(
    new Request('https://cdn.example/modules@2.2.2/cookies.min.js', {
      headers: {
        'if-none-match': '"abc"',
        'if-modified-since': 'Fri, 20 Nov 2026 00:00:00 GMT',
        authorization: 'secret',
        cookie: 'a=b',
        'accept-encoding': 'gzip',
      },
    }),
    env,
  );
  assert.equal(response.status, 304);
  assert.equal(await response.text(), '');
  assert.equal(response.headers.get('etag'), '"abc"');
  assert.equal(response.headers.get('cache-control'), IMMUTABLE_CACHE);
  assert.equal(response.headers.get('content-security-policy'), null);
  assert.equal(response.headers.get('content-type'), 'text/javascript; charset=utf-8');
});

test('missing assets are our 404, not the asset body', async () => {
  const env = {
    ASSETS: {
      async fetch() {
        return new Response('<html>missing</html>', {
          status: 404,
          headers: { 'content-type': 'text/html', 'x-asset': '1' },
        });
      },
    },
  };
  const response = await handleRequest(
    new Request('https://cdn.example/loader@2.5.0/missing.js'),
    env,
  );
  assert.equal(response.status, 404);
  assert.equal(await response.text(), 'Not found.\n');
  assert.equal(response.headers.get('x-asset'), null);
  assert.equal(response.headers.get('content-type'), 'text/plain; charset=utf-8');
});

test('root, manifest cache, OPTIONS, and rejected methods', async () => {
  let calls = 0;
  const env = {
    ASSETS: {
      async fetch() {
        calls += 1;
        return new Response('{"packages":[]}\n', {
          status: 200,
          headers: { etag: '"m"', 'content-length': '16' },
        });
      },
    },
  };
  const root = await handleRequest(new Request('https://cdn.example/'), env);
  assert.equal(root.status, 200);
  assert.equal(await root.text(), ROOT_BODY);
  assert.equal(root.headers.get('content-type'), 'text/plain; charset=utf-8');
  assert.equal(root.headers.get('cache-control'), SHORT_CACHE);
  assert.equal(calls, 0);

  const manifest = await handleRequest(new Request('https://cdn.example/manifest.json'), env);
  assert.equal(manifest.status, 200);
  assert.equal(manifest.headers.get('content-type'), 'application/json; charset=utf-8');
  assert.equal(manifest.headers.get('cache-control'), SHORT_CACHE);
  assert.equal(manifest.headers.get('etag'), '"m"');
  assert.equal(calls, 1);

  const options = await handleRequest(
    new Request('https://cdn.example/loader@2.5.0/loader.min.js', { method: 'OPTIONS' }),
    env,
  );
  assert.equal(options.status, 204);
  assert.equal(options.headers.get('access-control-allow-origin'), '*');
  assert.equal(options.headers.get('access-control-allow-methods'), 'GET, HEAD, OPTIONS');
  assert.equal(calls, 1);

  const post = await handleRequest(
    new Request('https://cdn.example/', { method: 'POST' }),
    env,
  );
  assert.equal(post.status, 405);
  assert.equal(post.headers.get('allow'), 'GET, HEAD, OPTIONS');
  assert.equal(calls, 1);
});

test('major aliases 302 to the highest stable version and 404 otherwise', async () => {
  const calls = [];
  const manifest = {
    packages: [
      { package: 'loader', version: '2.6.0-rc.1', files: [{ path: 'loader.min.js' }] },
      { package: 'loader', version: '1.3.0-beta.1', files: [{ path: 'loader.min.js' }] },
      {
        package: 'loader',
        version: '1.0.0',
        files: [{ path: 'loader.min.js' }, { path: 'legacy.js' }],
      },
      {
        package: 'loader',
        version: '2.5.0',
        files: [{ path: 'loader.min.js' }, { path: 'loader.js' }],
      },
      { package: 'loader', version: '1.2.0', files: [{ path: 'loader.min.js' }] },
      { package: 'loader', version: '3.0.0-alpha.1', files: [{ path: 'loader.min.js' }] },
      { package: 'loader', version: '3.0.0-beta.2', files: [{ path: 'loader.min.js' }] },
      { package: 'modules', version: '1.0.0', files: [{ path: 'inject.min.js' }] },
      { package: 'modules', version: '1.1.0', files: [{ path: 'inject.min.js' }] },
    ],
  };
  const env = {
    ASSETS: {
      async fetch(request) {
        calls.push(new URL(request.url).pathname);
        if (new URL(request.url).pathname === '/manifest.json') {
          return new Response(JSON.stringify(manifest), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          });
        }
        return new Response('should-not-serve', { status: 200 });
      },
    },
  };

  async function assertRedirect(url, location) {
    const response = await handleRequest(new Request(url), env);
    assert.equal(response.status, 302, url);
    assert.equal(response.headers.get('location'), location, url);
    assert.equal(response.headers.get('cache-control'), MAJOR_ALIAS_CACHE, url);
    assert.equal(response.headers.get('access-control-allow-origin'), '*');
    assert.equal(response.headers.get('cross-origin-resource-policy'), 'cross-origin');
    assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
    assert.equal(response.headers.get('timing-allow-origin'), '*');
    assert.equal(response.headers.get('content-type'), null);
    assert.equal(await response.text(), '');
  }

  async function assertMiss(url) {
    const response = await handleRequest(new Request(url), env);
    assert.equal(response.status, 404, url);
    assert.equal(response.headers.get('location'), null, url);
    assert.equal(response.headers.get('cache-control'), SHORT_CACHE, url);
    assert.equal(await response.text(), NOT_FOUND_BODY);
  }

  const range = await handleRequest(
    new Request('https://cdn.example/loader@2.5/loader.min.js'),
    env,
  );
  assert.equal(range.status, 404);
  assert.equal(await range.text(), ALIAS_BODY);
  const next = await handleRequest(
    new Request('https://cdn.example/loader@next/loader.min.js'),
    env,
  );
  assert.equal(next.status, 404);
  assert.equal(await next.text(), ALIAS_BODY);
  assert.deepEqual(calls, []);

  await assertRedirect(
    'https://cdn.example/loader@1/loader.min.js',
    '/loader@1.2.0/loader.min.js',
  );
  await assertRedirect(
    'https://cdn.example/loader%401/loader.min.js',
    '/loader@1.2.0/loader.min.js',
  );
  await assertRedirect(
    'https://cdn.example/loader@1.x/loader.min.js',
    '/loader@1.2.0/loader.min.js',
  );
  await assertRedirect(
    'https://cdn.example/loader%401.x/loader.min.js',
    '/loader@1.2.0/loader.min.js',
  );
  await assertRedirect(
    'https://cdn.example/loader@2/loader.min.js',
    '/loader@2.5.0/loader.min.js',
  );
  await assertRedirect(
    'https://cdn.example/modules@1/inject.min.js',
    '/modules@1.1.0/inject.min.js',
  );
  await assertRedirect(
    'https://cdn.example/loader@latest/loader.min.js',
    '/loader@2.5.0/loader.min.js',
  );

  const head = await handleRequest(
    new Request('https://cdn.example/loader@1/loader.min.js', { method: 'HEAD' }),
    env,
  );
  assert.equal(head.status, 302);
  assert.equal(head.headers.get('location'), '/loader@1.2.0/loader.min.js');
  assert.equal(head.headers.get('cache-control'), MAJOR_ALIAS_CACHE);
  assert.equal(await head.text(), '');

  await assertMiss('https://cdn.example/loader@9/loader.min.js');
  await assertMiss('https://cdn.example/loader@2/missing.js');
  await assertMiss('https://cdn.example/loader@1/legacy.js');
  await assertMiss('https://cdn.example/loader@3/loader.min.js');

  assert.deepEqual(calls, ['/manifest.json']);
});

test('short URLs serve an exact entry and redirect latest and majors', async () => {
  const calls = [];
  const manifest = {
    distTags: {
      loader: { latest: '2.5.0' },
      modules: { latest: '9.9.9' },
    },
    packages: [
      {
        package: 'loader',
        version: '1.0.0',
        entry: 'loader.js',
        files: [{ path: 'loader.js' }, { path: 'loader.min.js' }],
      },
      {
        package: 'loader',
        version: '1.2.0',
        entry: 'loader.min.js',
        files: [{ path: 'loader.min.js' }],
      },
      {
        package: 'loader',
        version: '2.5.0',
        entry: 'loader.min.js',
        files: [{ path: 'loader.min.js' }, { path: 'loader.js' }],
      },
      {
        package: 'loader',
        version: '2.6.0-rc.1',
        entry: 'loader.min.js',
        files: [{ path: 'loader.min.js' }],
      },
      {
        package: 'loader',
        version: '3.0.0-beta.1',
        entry: 'loader.min.js',
        files: [{ path: 'loader.min.js' }],
      },
      {
        package: 'modules',
        version: '1.1.0',
        entry: 'all.min.js',
        files: [{ path: 'all.min.js' }, { path: 'inject.min.js' }],
      },
      {
        package: 'modules',
        version: '2.2.2',
        entry: 'all.min.js',
        files: [{ path: 'all.min.js' }],
      },
    ],
  };
  const env = {
    ASSETS: {
      async fetch(request) {
        const path = decodeURIComponent(new URL(request.url).pathname);
        calls.push(path);
        if (path === '/manifest.json') {
          return new Response(JSON.stringify(manifest), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          });
        }
        return new Response(path, {
          status: 200,
          headers: { etag: '"e"', 'content-length': String(path.length) },
        });
      },
    },
  };

  const next = await handleRequest(new Request('https://cdn.example/loader@next'), env);
  assert.equal(next.status, 404);
  assert.equal(await next.text(), ALIAS_BODY);
  assert.deepEqual(calls, []);

  async function assertEntry(url, assetPath) {
    const response = await handleRequest(new Request(url), env);
    assert.equal(response.status, 200, url);
    assert.equal(response.headers.get('location'), null, url);
    assert.equal(response.headers.get('cache-control'), IMMUTABLE_CACHE, url);
    assert.equal(response.headers.get('content-type'), 'text/javascript; charset=utf-8');
    assert.equal(response.headers.get('access-control-allow-origin'), '*');
    assert.equal(response.headers.get('cross-origin-resource-policy'), 'cross-origin');
    assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
    assert.equal(response.headers.get('timing-allow-origin'), '*');
    assert.equal(await response.text(), assetPath, url);
  }

  async function assertRedirect(url, location) {
    const response = await handleRequest(new Request(url), env);
    assert.equal(response.status, 302, url);
    assert.equal(response.headers.get('location'), location, url);
    assert.equal(response.headers.get('cache-control'), MAJOR_ALIAS_CACHE, url);
    assert.equal(response.headers.get('access-control-allow-origin'), '*');
    assert.equal(await response.text(), '');
  }

  await assertEntry('https://cdn.example/loader@2.5.0', '/loader@2.5.0/loader.min.js');
  await assertEntry('https://cdn.example/loader%402.5.0/', '/loader@2.5.0/loader.min.js');
  await assertEntry('https://cdn.example/modules@2.2.2', '/modules@2.2.2/all.min.js');
  await assertEntry('https://cdn.example/loader@1.0.0', '/loader@1.0.0/loader.js');

  const head = await handleRequest(
    new Request('https://cdn.example/loader%402.5.0/', { method: 'HEAD' }),
    env,
  );
  assert.equal(head.status, 200);
  assert.equal(head.headers.get('cache-control'), IMMUTABLE_CACHE);
  assert.equal(head.headers.get('location'), null);
  assert.equal(await head.text(), '');

  const missing = await handleRequest(new Request('https://cdn.example/loader@9.9.9'), env);
  assert.equal(missing.status, 404);
  assert.equal(missing.headers.get('cache-control'), SHORT_CACHE);
  assert.equal(missing.headers.get('location'), null);
  assert.equal(await missing.text(), NOT_FOUND_BODY);

  await assertRedirect('https://cdn.example/loader', '/loader@2.5.0/loader.min.js');
  await assertRedirect('https://cdn.example/loader/', '/loader@2.5.0/loader.min.js');
  await assertRedirect('https://cdn.example/modules', '/modules@2.2.2/all.min.js');
  await assertRedirect('https://cdn.example/loader@latest', '/loader@2.5.0/loader.min.js');
  await assertRedirect('https://cdn.example/loader%40latest', '/loader@2.5.0/loader.min.js');
  await assertRedirect('https://cdn.example/loader@2', '/loader@2.5.0/loader.min.js');
  await assertRedirect('https://cdn.example/loader@2/', '/loader@2.5.0/loader.min.js');
  await assertRedirect('https://cdn.example/loader%402', '/loader@2.5.0/loader.min.js');
  await assertRedirect('https://cdn.example/loader@1.x', '/loader@1.2.0/loader.min.js');
  await assertRedirect('https://cdn.example/modules@1', '/modules@1.1.0/all.min.js');
  await assertRedirect(
    'https://cdn.example/loader@latest/loader.min.js',
    '/loader@2.5.0/loader.min.js',
  );
  await assertRedirect(
    'https://cdn.example/loader%40latest/loader.js',
    '/loader@2.5.0/loader.js',
  );

  const headLatest = await handleRequest(
    new Request('https://cdn.example/loader@latest', { method: 'HEAD' }),
    env,
  );
  assert.equal(headLatest.status, 302);
  assert.equal(headLatest.headers.get('location'), '/loader@2.5.0/loader.min.js');
  assert.equal(headLatest.headers.get('cache-control'), MAJOR_ALIAS_CACHE);
  assert.equal(await headLatest.text(), '');

  const range = await handleRequest(
    new Request('https://cdn.example/loader@2.5/loader.min.js'),
    env,
  );
  assert.equal(range.status, 404);
  assert.equal(await range.text(), ALIAS_BODY);

  const prerelease = await handleRequest(new Request('https://cdn.example/loader@3'), env);
  assert.equal(prerelease.status, 404);
  assert.equal(prerelease.headers.get('cache-control'), SHORT_CACHE);
  assert.equal(await prerelease.text(), NOT_FOUND_BODY);

  const missedFile = await handleRequest(
    new Request('https://cdn.example/loader@latest/missing.js'),
    env,
  );
  assert.equal(missedFile.status, 404);
  assert.equal(await missedFile.text(), NOT_FOUND_BODY);

  assert.equal(calls.filter((path) => path === '/manifest.json').length, 1);
  assert.ok(calls.includes('/loader@1.0.0/loader.js'));
  assert.equal(calls.includes('/loader@1.0.0/loader.min.js'), false);
});
