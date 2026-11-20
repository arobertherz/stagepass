import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { IMMUTABLE_CACHE, ROOT_BODY, SHORT_CACHE } from '../src/policy.js';
import { handleRequest } from '../src/worker.js';

function fakeRequest(url, method = 'GET', headers) {
  return { url, method, headers: new Headers(headers) };
}

test('worker source stays free of Node imports', async () => {
  for (const file of ['../src/worker.js', '../src/semver.js', '../src/policy.js']) {
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
