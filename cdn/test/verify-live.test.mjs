import assert from 'node:assert/strict';
import test from 'node:test';
import {
  encodedUrlPath,
  evaluateAssetHeaders,
  listManifestFiles,
  manifestDrift,
  normalizeBase,
  parseVerifyArgs,
  sampleEntries,
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
  assert.throws(() => parseVerifyArgs(['https://cdn.stagepass.one', '--all', '--sample', '2']));
});
