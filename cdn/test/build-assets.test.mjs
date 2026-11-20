import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import test from 'node:test';
import path from 'node:path';
import { tmpdir } from 'node:os';
import {
  ASSET_LIMITS,
  assertSafeOutDir,
  checkAssetLimits,
  chooseEntry,
  classifyTarEntry,
  integrityMatches,
  loadPackageConfig,
  manifestFromPackages,
  missingVersions,
  parseBuildArgs,
  selectVersions,
  serializeManifest,
  sriFor,
} from '../scripts/build-assets.mjs';
import { compareSemver, parseSemver } from '../src/semver.js';

const HELLO_SRI = 'sha512-m3HSJL1i83hdltRq0+o9czGb+8KJDKra4t/3JRlnPKcjI8PZm6XBHXx6zG4UuMXaDEZjR1wuXDre9G9zvN7AQw==';

test('selectVersions keeps every exact version, including 1.x and prereleases', () => {
  const selected = selectVersions(
    [
      '1.0.0',
      '1.2.0',
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
    { exclude: ['2.1.0'] },
  );
  assert.deepEqual(selected, [
    '1.0.0',
    '1.2.0',
    '1.9.9',
    '2.0.0-beta.1',
    '2.0.0',
    '2.3.0-beta.2',
    '2.3.0-beta.10',
    '2.3.0',
  ]);
});

test('semver precedence orders prereleases below the matching release', () => {
  assert.ok(compareSemver('2.3.0-beta.2', '2.3.0-beta.10') < 0);
  assert.ok(compareSemver('2.3.0-beta.1', '2.3.0') < 0);
  assert.ok(compareSemver('2.0.0', '2.0.0-rc.1') > 0);
  assert.ok(compareSemver('1.2.0', '1.3.0-beta.1') < 0);
});

test('a single npm version string is accepted', () => {
  assert.deepEqual(selectVersions('1.0.0'), ['1.0.0']);
  assert.deepEqual(selectVersions('2.5.0', {}), ['2.5.0']);
});

test('selected versions and the written manifest cover every registry version', async () => {
  const registries = {
    loader: ['2.0.0', '1.0.0', '1.2.0', '2.0.0-beta.1', '2.5.0', '2.6.0-rc.1', '2.0.0'],
    modules: ['2.2.2', '1.1.0', '1.0.0', '1.1.0-beta.1', '2.0.0'],
  };
  const packages = [
    { package: 'loader', npm: '@stagepass/loader', exclude: [] },
    { package: 'modules', npm: '@stagepass/modules', exclude: [] },
  ];
  const built = packages.map((pkg) => {
    const versions = selectVersions(registries[pkg.package], pkg);
    return {
      ...pkg,
      versions: versions.map((version) => ({
        version,
        integrity: 'sha512-test',
        tarball: `https://registry.npmjs.org/${pkg.npm}/-/${pkg.package}-${version}.tgz`,
        files: [{ path: 'file.js', bytes: 1, sha256: 'aa' }],
      })),
    };
  });
  assert.deepEqual(
    built.find((pkg) => pkg.package === 'loader').versions.map((item) => item.version),
    ['1.0.0', '1.2.0', '2.0.0-beta.1', '2.0.0', '2.5.0', '2.6.0-rc.1'],
  );
  assert.deepEqual(
    built.find((pkg) => pkg.package === 'modules').versions.map((item) => item.version),
    ['1.0.0', '1.1.0-beta.1', '1.1.0', '2.0.0', '2.2.2'],
  );

  const dir = await mkdtemp(path.join(tmpdir(), 'sp-cdn-manifest-'));
  try {
    const manifestPath = path.join(dir, 'manifest.json');
    await writeFile(manifestPath, serializeManifest(manifestFromPackages(built)));
    const written = JSON.parse(await readFile(manifestPath, 'utf8'));
    for (const [name, versions] of Object.entries(registries)) {
      for (const version of versions) {
        assert.equal(parseSemver(version) !== null, true, version);
        assert.ok(
          written.packages.some((pkg) => pkg.package === name && pkg.version === version),
          `${name}@${version}`,
        );
      }
    }
    const gaps = missingVersions(
      selectVersions(registries.loader, { exclude: [] }).map((version) => ({
        package: 'loader',
        version,
      })),
      written,
    );
    assert.deepEqual(gaps, []);
    const omitted = {
      packages: written.packages.filter((pkg) => !(pkg.package === 'loader' && pkg.version === '1.0.0')),
    };
    assert.deepEqual(missingVersions([{ package: 'loader', version: '1.0.0' }], omitted), [
      { package: 'loader', version: '1.0.0' },
    ]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('sha512 integrity must match the tarball bytes', () => {
  assert.equal(sriFor('hello'), HELLO_SRI);
  assert.equal(integrityMatches('hello', HELLO_SRI), true);
  assert.equal(integrityMatches('hello!', HELLO_SRI), false);
  assert.equal(integrityMatches('hello', 'sha256-aaaa'), false);
  assert.equal(integrityMatches('hello', 'sha512-short'), false);
  assert.equal(integrityMatches('hello', ''), false);
});

test('chooseEntry walks jsdelivr, unpkg, a browser string, then main', () => {
  const files = ['loader.js', 'loader.min.js', 'all.min.js'];
  assert.equal(chooseEntry({
    jsdelivr: 'dist/loader.js',
    unpkg: 'dist/loader.min.js',
    main: 'dist/loader.min.js',
  }, files, 'loader'), 'loader.js');
  assert.equal(chooseEntry({
    jsdelivr: 'dist/missing.js',
    unpkg: './dist/loader.min.js',
    browser: { '.': './dist/loader.js' },
    main: 'dist/loader.js',
  }, files, 'loader'), 'loader.min.js');
  assert.equal(chooseEntry({
    browser: 'dist/loader.js',
    main: 'dist/loader.min.js',
  }, files, 'loader'), 'loader.js');
  assert.equal(chooseEntry({ main: 'dist/loader.js' }, files, 'loader'), 'loader.js');
  assert.equal(chooseEntry({ main: './dist/loader.min.js' }, files, 'loader'), 'loader.min.js');
  assert.equal(chooseEntry({ main: 'src/index.js' }, files, 'loader'), 'loader.min.js');
  assert.equal(chooseEntry({}, files, 'modules'), 'all.min.js');
  assert.throws(
    () => chooseEntry({ main: 'src/missing.js' }, ['other.js'], 'loader', 'loader@0.0.0'),
    /no entry file for loader@0.0.0/,
  );
});

test('tar entries outside package/dist are skipped or rejected', () => {
  assert.equal(classifyTarEntry('package/dist/loader.min.js'), 'dist');
  assert.equal(classifyTarEntry('package/dist/vendor/cookies.min.js'), 'dist');
  assert.equal(classifyTarEntry('package/dist/'), 'dist');
  assert.equal(classifyTarEntry('package/package.json'), 'package-json');
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

test('versions.config.json names both packages and keeps exclude empty', async () => {
  const config = await loadPackageConfig();
  assert.deepEqual(
    config.packages.map((pkg) => [pkg.package, pkg.npm, pkg.exclude]),
    [
      ['loader', '@stagepass/loader', []],
      ['modules', '@stagepass/modules', []],
    ],
  );
});

test('a floor key or a non-exact exclude entry is rejected', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'sp-cdn-config-'));
  try {
    const floorPath = path.join(dir, 'floor.json');
    await writeFile(floorPath, JSON.stringify({
      packages: [{ package: 'loader', npm: '@stagepass/loader', floor: '2.0.0', exclude: [] }],
    }));
    await assert.rejects(() => loadPackageConfig(floorPath), /floor/);

    const excludePath = path.join(dir, 'exclude.json');
    await writeFile(excludePath, JSON.stringify({
      packages: [{ package: 'loader', npm: '@stagepass/loader', exclude: ['2'] }],
    }));
    await assert.rejects(() => loadPackageConfig(excludePath), /exact version/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
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
