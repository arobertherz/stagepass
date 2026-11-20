import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import {
  checkRegistryCoverage,
  encodedUrlPath,
  evaluateAssetHeaders,
  listManifestFiles,
  manifestDrift,
  missingRegistryVersions,
  normalizeBase,
  parseVerifyArgs,
  sampleEntries,
  shortUrlChecks,
  verifyShortUrls,
} from '../scripts/verify-live.mjs';

function headers(entries) {
  return new Headers(entries);
}

const good = {
  'access-control-allow-origin': '*',
  'cross-origin-resource-policy': 'cross-origin',
  'x-content-type-options': 'nosniff',
  'timing-allow-origin': '*',
  'content-type': 'text/javascript; charset=utf-8',
  'cache-control': 'public, max-age=31536000, immutable',
};

test('required asset headers pass and zone security headers warn', () => {
  const clean = evaluateAssetHeaders(headers(good), {
    contentType: 'text/javascript; charset=utf-8',
  });
  assert.deepEqual(clean.errors, []);
  assert.deepEqual(clean.warnings, []);

  const zoned = evaluateAssetHeaders(headers({
    ...good,
    'content-security-policy': "default-src 'self'",
    'cross-origin-opener-policy': 'same-origin',
    'x-frame-options': 'DENY',
  }), { contentType: 'text/javascript; charset=utf-8' });
  assert.deepEqual(zoned.errors, []);
  assert.deepEqual(zoned.warnings, [
    'content-security-policy',
    'cross-origin-opener-policy',
    'x-frame-options',
  ]);
});

test('missing CORS or a mutable cache is a failure', () => {
  const evaluated = evaluateAssetHeaders(headers({
    ...good,
    'access-control-allow-origin': 'https://example.com',
    'cache-control': 'public, max-age=60',
  }), { contentType: 'text/javascript; charset=utf-8' });
  assert.ok(evaluated.errors.includes('access-control-allow-origin'));
  assert.ok(evaluated.errors.includes('cache-control'));
});

test('sample keeps the ends of the manifest and encodes @ once', () => {
  const manifest = {
    packages: [
      {
        package: 'loader',
        version: '2.5.0',
        files: [
          { path: 'loader.min.js', bytes: 4, sha256: 'abcd' },
          { path: 'loader.js', bytes: 5, sha256: 'eeff' },
        ],
      },
      {
        package: 'modules',
        version: '2.2.2',
        files: [{ path: 'cookies.min.js', bytes: 3, sha256: '0011' }],
      },
    ],
  };
  const files = listManifestFiles(manifest);
  assert.deepEqual(files.map((file) => file.urlPath), [
    '/loader@2.5.0/loader.js',
    '/loader@2.5.0/loader.min.js',
    '/modules@2.2.2/cookies.min.js',
  ]);
  assert.equal(encodedUrlPath('/loader@2.5.0/loader.min.js'), '/loader%402.5.0/loader.min.js');
  const sample = sampleEntries(files, 2);
  assert.equal(sample[0].urlPath, files[0].urlPath);
  assert.equal(sample.at(-1).urlPath, files.at(-1).urlPath);
  assert.equal(manifestDrift(manifest, manifest).ok, true);
  const drifted = manifestDrift(manifest, { packages: [] });
  assert.equal(drifted.ok, false);
  assert.equal(drifted.missingRemote.length, 3);
});

test('verify args', () => {
  assert.equal(normalizeBase('https://staging-cdn.stagepass.one'), 'https://staging-cdn.stagepass.one');
  assert.throws(() => normalizeBase('https://cdn.stagepass.one/loader'));
  const all = parseVerifyArgs(['https://cdn.stagepass.one', '--all', '--local', 'none']);
  assert.equal(all.all, true);
  assert.equal(all.localMode, 'none');
  assert.equal(all.registry, false);
  const flagged = parseVerifyArgs(['https://cdn.stagepass.one', '--registry', '--sample', '1']);
  assert.equal(flagged.registry, true);
  assert.equal(flagged.sample, 1);
  assert.throws(() => parseVerifyArgs(['https://cdn.stagepass.one', '--all', '--sample', '2']));
});

test('registry coverage requires every published version except an explicit exclude', () => {
  const registry = [
    '1.0.0',
    '1.2.0',
    '2.0.0-beta.1',
    '2.0.0',
    '2.5.0',
    '2.6.0-rc.1',
  ];
  const manifest = {
    packages: [
      { package: 'loader', version: '1.0.0' },
      { package: 'loader', version: '1.2.0' },
      { package: 'loader', version: '2.0.0-beta.1' },
      { package: 'loader', version: '2.0.0' },
      { package: 'loader', version: '2.5.0' },
      { package: 'loader', version: '2.6.0-rc.1' },
      { package: 'modules', version: '1.1.0' },
    ],
  };
  assert.deepEqual(
    missingRegistryVersions(registry, manifest, { package: 'loader', exclude: [] }),
    [],
  );
  const partial = {
    packages: manifest.packages.filter((pkg) => pkg.version !== '1.0.0' && pkg.version !== '2.0.0-beta.1'),
  };
  assert.deepEqual(
    missingRegistryVersions(registry, partial, { package: 'loader', exclude: [] }),
    [
      { package: 'loader', version: '1.0.0' },
      { package: 'loader', version: '2.0.0-beta.1' },
    ],
  );
  assert.deepEqual(
    missingRegistryVersions(registry, partial, { package: 'loader', exclude: ['1.0.0'] }),
    [{ package: 'loader', version: '2.0.0-beta.1' }],
  );
  assert.deepEqual(
    missingRegistryVersions(['1.0.0', '1.1.0'], manifest, { package: 'modules', exclude: [] }),
    [{ package: 'modules', version: '1.0.0' }],
  );
});

test('checkRegistryCoverage uses the injected version list', async () => {
  const coverage = await checkRegistryCoverage({
    manifest: {
      packages: [
        { package: 'loader', version: '1.2.0' },
        { package: 'modules', version: '1.1.0' },
      ],
    },
    packages: [
      { package: 'loader', npm: '@stagepass/loader', exclude: [] },
      { package: 'modules', npm: '@stagepass/modules', exclude: ['1.0.0'] },
    ],
    readVersions: async (npmName) => {
      if (npmName === '@stagepass/loader') return ['1.0.0', '1.2.0', '2.0.0-rc.1', '2.5.0'];
      if (npmName === '@stagepass/modules') return ['1.0.0', '1.1.0'];
      throw new Error(`unexpected ${npmName}`);
    },
  });
  assert.equal(coverage.required, 5);
  assert.deepEqual(coverage.missing, [
    { package: 'loader', version: '1.0.0' },
    { package: 'loader', version: '2.0.0-rc.1' },
    { package: 'loader', version: '2.5.0' },
  ]);
});

test('short URL plan covers every version and the alias targets', () => {
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
        files: [{ path: 'loader.js', bytes: 4, sha256: 'aaa' }, { path: 'loader.min.js', bytes: 3, sha256: 'bbb' }],
      },
      {
        package: 'loader',
        version: '1.2.0',
        entry: 'loader.min.js',
        files: [{ path: 'loader.min.js', bytes: 3, sha256: 'ccc' }],
      },
      {
        package: 'loader',
        version: '2.5.0',
        entry: 'loader.min.js',
        files: [{ path: 'loader.min.js', bytes: 3, sha256: 'ddd' }, { path: 'loader.js', bytes: 4, sha256: 'eee' }],
      },
      {
        package: 'loader',
        version: '2.6.0-rc.1',
        entry: 'loader.min.js',
        files: [{ path: 'loader.min.js', bytes: 3, sha256: 'fff' }],
      },
      {
        package: 'modules',
        version: '1.1.0',
        entry: 'all.min.js',
        files: [{ path: 'all.min.js', bytes: 2, sha256: '111' }],
      },
      {
        package: 'modules',
        version: '2.2.2',
        entry: 'all.min.js',
        files: [{ path: 'all.min.js', bytes: 2, sha256: '222' }],
      },
    ],
  };
  const plan = shortUrlChecks(manifest);
  assert.deepEqual(plan.entries.map((entry) => [entry.urlPath, entry.entry, entry.sha256]), [
    ['/loader@1.0.0', 'loader.js', 'aaa'],
    ['/loader@1.2.0', 'loader.min.js', 'ccc'],
    ['/loader@2.5.0', 'loader.min.js', 'ddd'],
    ['/loader@2.6.0-rc.1', 'loader.min.js', 'fff'],
    ['/modules@1.1.0', 'all.min.js', '111'],
    ['/modules@2.2.2', 'all.min.js', '222'],
  ]);
  assert.deepEqual(plan.redirects, [
    { urlPath: '/loader', location: '/loader@2.5.0/loader.min.js' },
    { urlPath: '/loader@latest', location: '/loader@2.5.0/loader.min.js' },
    { urlPath: '/loader@1', location: '/loader@1.2.0/loader.min.js' },
    { urlPath: '/loader@2', location: '/loader@2.5.0/loader.min.js' },
    { urlPath: '/modules', location: '/modules@2.2.2/all.min.js' },
    { urlPath: '/modules@latest', location: '/modules@2.2.2/all.min.js' },
    { urlPath: '/modules@1', location: '/modules@1.1.0/all.min.js' },
    { urlPath: '/modules@2', location: '/modules@2.2.2/all.min.js' },
  ]);
});

test('verifyShortUrls accepts entry bytes and 300 second redirects', async () => {
  const body = 'loader-js';
  const sha = createHash('sha256').update(body).digest('hex');
  const manifest = {
    distTags: { loader: { latest: '1.0.0' } },
    packages: [
      {
        package: 'loader',
        version: '1.0.0',
        entry: 'loader.js',
        files: [{ path: 'loader.js', bytes: body.length, sha256: sha }],
      },
    ],
  };
  const headers = {
    'access-control-allow-origin': '*',
    'cross-origin-resource-policy': 'cross-origin',
    'x-content-type-options': 'nosniff',
    'timing-allow-origin': '*',
    'content-type': 'text/javascript; charset=utf-8',
    'cache-control': 'public, max-age=31536000, immutable',
  };
  const result = await verifyShortUrls({
    base: 'https://cdn.example',
    manifest,
    warnings: new Set(),
    fetchImpl: async (url) => {
      const path = decodeURIComponent(new URL(url).pathname);
      if (path === '/loader@1.0.0') {
        return new Response(body, { status: 200, headers });
      }
      return new Response('', {
        status: 302,
        headers: {
          location: '/loader@1.0.0/loader.js',
          'cache-control': 'public, max-age=300',
          'access-control-allow-origin': '*',
        },
      });
    },
  });
  assert.deepEqual(result.failures, []);

  const missed = await verifyShortUrls({
    base: 'https://cdn.example',
    manifest,
    warnings: new Set(),
    fetchImpl: async () => new Response('nope', {
      status: 200,
      headers: { ...headers, 'cache-control': 'public, max-age=60' },
    }),
  });
  assert.ok(missed.failures.length > 0);
});
