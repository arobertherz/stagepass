import assert from 'node:assert/strict';
import test from 'node:test';
import path from 'node:path';
import { tmpdir } from 'node:os';
import {
  ASSET_LIMITS,
  assertSafeOutDir,
  checkAssetLimits,
  classifyTarEntry,
  integrityMatches,
  loadPackageConfig,
  missingVersions,
  parseBuildArgs,
  selectVersions,
  sriFor,
} from '../scripts/build-assets.mjs';
import { compareSemver, versionAtLeast } from '../src/semver.js';

const HELLO_SRI = 'sha512-m3HSJL1i83hdltRq0+o9czGb+8KJDKra4t/3JRlnPKcjI8PZm6XBHXx6zG4UuMXaDEZjR1wuXDre9G9zvN7AQw==';

test('version floor keeps later prereleases and drops versions before the floor', () => {
  const selected = selectVersions(
    [
      '1.9.9',
      '2.0.0-beta.1',
      '2.0.0',
      '2.1.0',
      '2.3.0-beta.10',
      '2.3.0-beta.2',
      '2.3.0',
      'latest',
      '2.0.0',
    ],
    { floor: '2.0.0', exclude: ['2.1.0'] },
  );
  assert.deepEqual(selected, ['2.0.0', '2.3.0-beta.2', '2.3.0-beta.10', '2.3.0']);
});

test('semver precedence orders prereleases below the matching release', () => {
  assert.equal(versionAtLeast('2.3.0-beta.1', '2.0.0'), true);
  assert.equal(versionAtLeast('2.0.0-beta.1', '2.0.0'), false);
  assert.equal(versionAtLeast('2.0.0', '2.0.0'), true);
  assert.ok(compareSemver('2.3.0-beta.2', '2.3.0-beta.10') < 0);
  assert.ok(compareSemver('2.3.0-beta.1', '2.3.0') < 0);
  assert.ok(compareSemver('2.0.0', '2.0.0-rc.1') > 0);
});

test('a single npm version string is accepted', () => {
  assert.deepEqual(selectVersions('2.5.0', { floor: '2.0.0' }), ['2.5.0']);
});

test('sha512 integrity must match the tarball bytes', () => {
  assert.equal(sriFor('hello'), HELLO_SRI);
  assert.equal(integrityMatches('hello', HELLO_SRI), true);
  assert.equal(integrityMatches('hello!', HELLO_SRI), false);
  assert.equal(integrityMatches('hello', 'sha256-aaaa'), false);
  assert.equal(integrityMatches('hello', 'sha512-short'), false);
  assert.equal(integrityMatches('hello', ''), false);
});

test('tar entries outside package/dist are skipped or rejected', () => {
  assert.equal(classifyTarEntry('package/dist/loader.min.js'), 'dist');
  assert.equal(classifyTarEntry('package/dist/vendor/cookies.min.js'), 'dist');
  assert.equal(classifyTarEntry('package/dist/'), 'dist');
  assert.equal(classifyTarEntry('package/package.json'), 'skip');
  assert.equal(classifyTarEntry('package/README.md'), 'skip');
  assert.equal(classifyTarEntry('package/dist/../../package.json'), 'reject');
  assert.equal(classifyTarEntry('package/../../etc/passwd'), 'reject');
  assert.equal(classifyTarEntry('/etc/passwd'), 'reject');
  assert.equal(classifyTarEntry('package\\dist\\loader.min.js'), 'reject');
  assert.equal(classifyTarEntry('package/dist/foo\0.js'), 'reject');
});

test('asset limits enforce the Workers Free file count and 25 MiB cap', () => {
  const max = ASSET_LIMITS.maxFileBytes;
  assert.equal(checkAssetLimits([{ path: 'a.js', bytes: max }]).ok, true);
  assert.equal(checkAssetLimits([{ path: 'a.js', bytes: max + 1 }]).ok, false);
  const tooMany = Array.from({ length: ASSET_LIMITS.maxFiles + 1 }, (_, index) => ({
    path: `${index}.js`,
    bytes: 1,
  }));
  assert.equal(checkAssetLimits(tooMany).ok, false);
});

test('output directory guards refuse the filesystem root and the source tree', () => {
  assert.throws(() => assertSafeOutDir('/'));
  assert.throws(() => assertSafeOutDir('/tmp'));
  const out = assertSafeOutDir(path.join(tmpdir(), 'sp-cdn-out', 'dist'));
  assert.equal(out, path.resolve(path.join(tmpdir(), 'sp-cdn-out', 'dist')));
  assert.throws(() => assertSafeOutDir(out, [out]));
});

test('versions.config.json floors both packages at 2.0.0', async () => {
  const config = await loadPackageConfig();
  assert.deepEqual(
    config.packages.map((pkg) => [pkg.package, pkg.npm, pkg.floor]),
    [
      ['loader', '@stagepass/loader', '2.0.0'],
      ['modules', '@stagepass/modules', '2.0.0'],
    ],
  );
});

test('missingVersions reports npm versions absent from a manifest', () => {
  const missing = missingVersions(
    [
      { package: 'loader', version: '2.4.0' },
      { package: 'loader', version: '2.5.0' },
      { package: 'modules', version: '2.2.2' },
    ],
    {
      packages: [
        { package: 'loader', version: '2.5.0' },
        { package: 'modules', version: '2.2.2' },
      ],
    },
  );
  assert.deepEqual(missing, [{ package: 'loader', version: '2.4.0' }]);
});

test('build args accept a positional directory or --out', () => {
  assert.deepEqual(parseBuildArgs(['/tmp/out']), { help: false, out: '/tmp/out', config: undefined });
  assert.equal(parseBuildArgs(['--help']).help, true);
  assert.throws(() => parseBuildArgs(['--out']));
  assert.throws(() => parseBuildArgs(['/tmp/out', '--out', '/tmp/other']));
});
