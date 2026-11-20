import assert from 'node:assert/strict';
import test from 'node:test';
import worker, { describeRequest, handleRequest } from '../src/worker.js';
import {
  DEFAULT_INTERNAL_HOSTS,
  USAGE_BLOB_ORDER,
  embeddingHost,
  isInternal,
  parseInternalHosts,
  usagePoint,
} from '../src/usage.js';

function requestWith(url, headers, cf, seen) {
  const bag = new Map();
  for (const [name, value] of Object.entries(headers || {})) bag.set(name.toLowerCase(), value);
  return {
    url,
    method: 'GET',
    cf,
    headers: {
      get(name) {
        const key = String(name).toLowerCase();
        if (seen) seen.push(key);
        return bag.has(key) ? bag.get(key) : null;
      },
    },
  };
}

test('embedding host prefers Origin, then Referer, and keeps hostname only', () => {
  const origin = requestWith('https://cdn.example/loader@2.5.0/loader.min.js?token=QUERYSECRET', {
    origin: 'https://Shop.Example:8443/ignored-origin-path?drop=1',
    referer: 'https://other.example/cart/private-page?ref=REFQUERY',
  });
  assert.equal(embeddingHost(origin), 'shop.example');

  const referer = requestWith('https://cdn.example/loader@2.5.0?x=1', {
    referer: 'https://docs.example:9443/guide/install?utm=1#top',
  });
  assert.equal(embeddingHost(referer), 'docs.example');

  const userinfo = requestWith('https://cdn.example/', {
    referer: 'https://user:secret@shop.example/path?q=1',
  });
  assert.equal(embeddingHost(userinfo), 'shop.example');

  assert.equal(embeddingHost(requestWith('https://cdn.example/', {})), 'none');
  assert.equal(
    embeddingHost(requestWith('https://cdn.example/', {
      origin: 'null',
      referer: 'https://shop.example/still-ignored',
    })),
    'none',
  );
  assert.equal(embeddingHost(requestWith('https://cdn.example/', { origin: 'not a url' })), 'invalid');
  assert.equal(
    embeddingHost(requestWith('https://cdn.example/', { origin: 'https://bad_host.example/' })),
    'invalid',
  );

  const trailing = requestWith('https://cdn.example/', { origin: 'https://CDN.Example.COM./a' });
  assert.equal(embeddingHost(trailing), 'cdn.example.com');

  const ipv4 = requestWith('https://cdn.example/', { origin: 'http://127.0.0.1:8787/admin?x=1' });
  assert.equal(embeddingHost(ipv4), '127.0.0.1');

  // IPv6 literals contain ":" and are not a hostname we store. They are "invalid".
  const ipv6 = requestWith('https://cdn.example/', { origin: 'https://[2001:db8::1]/path?q=1' });
  assert.equal(embeddingHost(ipv6), 'invalid');
  const loopback = requestWith('https://cdn.example/', { origin: 'https://[::1]:443/' });
  assert.equal(embeddingHost(loopback), 'invalid');

  const idn = requestWith('https://cdn.example/', { origin: 'https://münchen.example/pfad?q=1' });
  const expected = new URL('https://münchen.example/pfad?q=1').hostname;
  assert.equal(embeddingHost(idn), expected);
  assert.equal(expected.includes('xn--'), true);
  assert.equal(/[^\x00-\x7f]/.test(expected), false);

  const tooLong = `https://${'a'.repeat(97)}.example/`;
  assert.equal(embeddingHost(requestWith('https://cdn.example/', { origin: tooLong })), 'invalid');
});

test('internal hosts match an exact name or a *. suffix', () => {
  const list = parseInternalHosts(DEFAULT_INTERNAL_HOSTS);
  assert.equal(isInternal('stagepass.one', list), true);
  assert.equal(isInternal('www.stagepass.one', list), true);
  assert.equal(isInternal('staging-cdn.stagepass.one', list), true);
  assert.equal(isInternal('a.b.stagepass.one', list), true);
  assert.equal(isInternal('stagepass.one.evil.test', list), false);
  assert.equal(isInternal('notstagepass.one', list), false);
  assert.equal(isInternal('localhost', list), true);
  assert.equal(isInternal('127.0.0.1', list), true);
  assert.equal(isInternal('shop.example', list), false);
  assert.equal(isInternal('none', list), false);
  assert.equal(isInternal('invalid', list), false);
  assert.equal(isInternal('WWW.STAGEPASS.ONE', ['*.stagepass.one']), false);
});

test('usage point layout is fixed and truncated', () => {
  assert.deepEqual(USAGE_BLOB_ORDER, [
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
  assert.deepEqual(usagePoint({
    host: 'shop.example',
    internal: false,
    env: 'production',
    pkg: 'loader',
    resolvedVersion: '2.5.0',
    specKind: 'exact',
    spec: '2.5.0',
    file: 'loader.min.js',
    country: 'DE',
    status: 200,
  }), {
    indexes: ['shop.example'],
    blobs: [
      'production',
      'shop.example',
      '0',
      'loader',
      '2.5.0',
      'exact',
      '2.5.0',
      'loader.min.js',
      'DE',
      '200',
    ],
    doubles: [1, 200],
  });
  assert.equal(usagePoint({
    host: 'stagepass.one',
    internal: true,
    env: 'staging',
    pkg: 'unknown',
    resolvedVersion: '',
    specKind: 'none',
    spec: '',
    file: '',
    country: 'XX',
    status: 404,
  }).blobs[2], '1');

  const long = 'h'.repeat(200);
  const clipped = usagePoint({
    host: long,
    internal: false,
    env: 'e'.repeat(300),
    pkg: 'loader',
    resolvedVersion: '',
    specKind: 'exact',
    spec: '2.5.0',
    file: '',
    country: 'DE',
    status: 200,
  });
  assert.equal(clipped.indexes[0].length, 96);
  assert.equal(clipped.blobs[0].length, 128);
  assert.equal(clipped.blobs[1].length, 96);
  assert.deepEqual(Object.keys(clipped).sort(), ['blobs', 'doubles', 'indexes']);
});

function assetEnv(manifest, extra) {
  return {
    CDN_ENV: 'staging',
    INTERNAL_HOSTS: DEFAULT_INTERNAL_HOSTS,
    ASSETS: {
      async fetch(request) {
        const path = new URL(request.url).pathname;
        if (path === '/manifest.json') {
          return new Response(JSON.stringify(manifest), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          });
        }
        return new Response('asset-body', {
          status: 200,
          headers: { etag: '"e"', 'content-length': '10' },
        });
      },
    },
    ...extra,
  };
}

const manifest = {
  distTags: { loader: { latest: '2.5.0' }, modules: { latest: '2.2.2' } },
  packages: [
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
      package: 'modules',
      version: '2.2.2',
      entry: 'all.min.js',
      files: [{ path: 'all.min.js' }],
    },
  ],
};

test('a written point contains no IP, user agent, cookie, path, or query', async () => {
  const points = [];
  let waited;
  const seen = [];
  const env = assetEnv(manifest, {
    USAGE: {
      writeDataPoint(point) {
        points.push(point);
      },
    },
  });
  const ctx = {
    waitUntil(promise) {
      waited = promise;
    },
  };
  const request = requestWith(
    'https://cdn.example/loader@2.5.0/loader.min.js?token=QUERYSECRET&utm=1',
    {
      origin: 'https://Shop.Example:8443/ignored-origin-path?drop=1',
      referer: 'https://user:secret@docs.example/cart/private-page?ref=REFQUERY#frag',
      'cf-connecting-ip': '203.0.113.55',
      'x-forwarded-for': '198.51.100.23, 203.0.113.55',
      'x-real-ip': '192.0.2.10',
      'user-agent': 'SecretBrowser/9.9',
      cookie: 'session=COOKIESECRET',
    },
    { country: 'de', city: 'BerlinSecret', postalCode: 'POSTAL99881' },
    seen,
  );
  const response = await worker.fetch(request, env, ctx);
  assert.equal(response.status, 200);
  assert.equal(await response.text(), 'asset-body');
  await waited;
  assert.equal(points.length, 1);
  assert.deepEqual(seen.filter((name) => name !== 'if-none-match' && name !== 'if-modified-since'), ['origin']);
  for (const name of ['referer', 'cookie', 'user-agent', 'cf-connecting-ip', 'x-forwarded-for', 'x-real-ip']) {
    assert.equal(seen.includes(name), false, name);
  }
  const dumped = JSON.stringify(points[0]);
  for (const secret of [
    '203.0.113.55',
    '198.51.100.23',
    '192.0.2.10',
    'SecretBrowser',
    'COOKIESECRET',
    'ignored-origin-path',
    'private-page',
    'REFQUERY',
    'QUERYSECRET',
    'token=',
    'utm=',
    'BerlinSecret',
    'POSTAL99881',
    'user:secret',
    '8443',
    'docs.example',
  ]) {
    assert.equal(dumped.includes(secret), false, secret);
  }
  assert.deepEqual(points[0], usagePoint({
    host: 'shop.example',
    internal: false,
    env: 'staging',
    pkg: 'loader',
    resolvedVersion: '2.5.0',
    specKind: 'exact',
    spec: '2.5.0',
    file: 'loader.min.js',
    country: 'DE',
    status: 200,
  }));
});

test('aliases record the resolved version and a throwing dataset does not change the response', async () => {
  const points = [];
  const jobs = [];
  const env = assetEnv(manifest, {
    USAGE: {
      writeDataPoint(point) {
        points.push(point);
      },
    },
  });
  const ctx = { waitUntil(promise) { jobs.push(promise); } };
  const major = await worker.fetch(new Request('https://cdn.example/loader@2.x/'), env, ctx);
  assert.equal(major.status, 302);
  assert.equal(major.headers.get('location'), '/loader@2.5.0/loader.min.js');
  const latest = await worker.fetch(
    new Request('https://cdn.example/loader@latest/loader.js'),
    env,
    ctx,
  );
  assert.equal(latest.status, 302);
  assert.equal(latest.headers.get('location'), '/loader@2.5.0/loader.js');
  const unknown = await worker.fetch(new Request('https://cdn.example/nope'), env, ctx);
  assert.equal(unknown.status, 404);
  const options = await worker.fetch(
    new Request('https://cdn.example/loader@2', { method: 'OPTIONS' }),
    env,
    ctx,
  );
  assert.equal(options.status, 204);
  const denied = await worker.fetch(
    new Request('https://cdn.example/modules@2.2.2', { method: 'POST' }),
    env,
    ctx,
  );
  assert.equal(denied.status, 405);
  await Promise.all(jobs);
  assert.equal(points[0].blobs[3], 'loader');
  assert.equal(points[0].blobs[4], '2.5.0');
  assert.equal(points[0].blobs[5], 'range');
  assert.equal(points[0].blobs[6], '2.x');
  assert.equal(points[0].blobs[7], 'loader.min.js');
  assert.equal(points[0].doubles[1], 302);
  assert.equal(points[1].blobs[5], 'latest');
  assert.equal(points[1].blobs[6], 'latest');
  assert.equal(points[1].blobs[4], '2.5.0');
  assert.equal(points[1].blobs[7], 'loader.js');
  assert.equal(points[2].blobs[3], 'unknown');
  assert.equal(points[2].blobs[5], 'none');
  assert.equal(points[2].doubles[1], 404);
  assert.equal(points[3].doubles[1], 204);
  assert.equal(points[3].blobs[5], 'range');
  assert.equal(points[3].blobs[6], '2');
  assert.equal(points[4].blobs[3], 'modules');
  assert.equal(points[4].blobs[5], 'exact');
  assert.equal(points[4].doubles[1], 405);

  const plain = await handleRequest(
    new Request('https://cdn.example/loader@2.5.0/loader.min.js'),
    assetEnv(manifest),
  );
  let called = false;
  const broken = assetEnv(manifest, {
    USAGE: {
      writeDataPoint() {
        throw new Error('203.0.113.9 dataset down');
      },
    },
  });
  const brokenCtx = { waitUntil(promise) { jobs.push(promise); } };
  const response = await worker.fetch(
    new Request('https://cdn.example/loader@2.5.0/loader.min.js'),
    broken,
    brokenCtx,
  );
  assert.equal(response.status, plain.status);
  assert.equal(await response.text(), await plain.text());
  await Promise.all(jobs.map((job) => job.catch(() => { called = true; })));
  assert.equal(response.headers.get('cache-control'), plain.headers.get('cache-control'));
  assert.equal(called, false);

  let waited = false;
  const missing = await worker.fetch(
    new Request('https://cdn.example/loader@2.5.0/loader.min.js'),
    assetEnv(manifest),
    { waitUntil() { waited = true; } },
  );
  assert.equal(missing.status, 200);
  assert.equal(waited, false);
  const noCtx = await worker.fetch(
    new Request('https://cdn.example/loader@2.5.0/loader.min.js'),
    broken,
  );
  assert.equal(noCtx.status, 200);

  const described = await describeRequest(
    new Request('https://www.stagepass.one/', { headers: { origin: 'https://www.stagepass.one/' } }),
    assetEnv(manifest),
  );
  assert.equal(described.response.status, 200);
  assert.equal(described.usage.pkg, '');
  assert.equal(described.usage.specKind, 'none');
});
