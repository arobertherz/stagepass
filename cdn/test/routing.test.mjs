import assert from 'node:assert/strict';
import test from 'node:test';
import { classifyPath, rawPathname, sameAssetLocation } from '../src/worker.js';

test('rawPathname keeps %40 and drops the query', () => {
  assert.equal(
    rawPathname('https://cdn.stagepass.one/loader%402.5.0/loader.min.js?x=1'),
    '/loader%402.5.0/loader.min.js',
  );
  assert.equal(rawPathname('https://cdn.stagepass.one/'), '/');
  assert.equal(rawPathname('/modules@2.2.2/cookies.min.js'), '/modules@2.2.2/cookies.min.js');
});

test('literal @ and %40 both classify as the same asset', () => {
  const literal = classifyPath('/loader@2.5.0/loader.min.js');
  const encoded = classifyPath('/loader%402.5.0/loader.min.js');
  const upper = classifyPath(`/loader${'%40'.toUpperCase()}2.5.0/loader.min.js`);
  for (const route of [literal, encoded, upper]) {
    assert.equal(route.kind, 'asset');
    assert.equal(route.packageName, 'loader');
    assert.equal(route.version, '2.5.0');
    assert.equal(route.file, 'loader.min.js');
    assert.equal(route.literalPath, '/loader@2.5.0/loader.min.js');
    assert.equal(route.encodedPath, '/loader%402.5.0/loader.min.js');
  }
});

test('nested dist paths and prerelease versions are exact assets', () => {
  const route = classifyPath('/modules@2.3.0-beta.1/vendor/cookies.min.js');
  assert.equal(route.kind, 'asset');
  assert.equal(route.file, 'vendor/cookies.min.js');
  assert.equal(route.encodedPath, '/modules%402.3.0-beta.1/vendor/cookies.min.js');
});

test('manifest and root are not package paths', () => {
  assert.equal(classifyPath('/').kind, 'root');
  assert.equal(classifyPath('/manifest.json').kind, 'manifest');
  assert.equal(classifyPath('/manifest.json/extra').kind, 'invalid');
});

test('major aliases classify @N and @N.x for both spellings', () => {
  const cases = [
    ['/loader@1/loader.min.js', 'loader', 1, 'loader.min.js'],
    ['/loader%401/loader.min.js', 'loader', 1, 'loader.min.js'],
    [`/loader${'%40'.toUpperCase()}1/loader.min.js`, 'loader', 1, 'loader.min.js'],
    ['/loader@1.x/loader.min.js', 'loader', 1, 'loader.min.js'],
    ['/loader%401.x/loader.min.js', 'loader', 1, 'loader.min.js'],
    ['/loader@2/loader.min.js', 'loader', 2, 'loader.min.js'],
    ['/modules@2/inject.min.js', 'modules', 2, 'inject.min.js'],
    ['/modules@2.x/vendor/cookies.min.js', 'modules', 2, 'vendor/cookies.min.js'],
    ['/loader@9/missing.js', 'loader', 9, 'missing.js'],
    ['/loader@3/loader.min.js', 'loader', 3, 'loader.min.js'],
  ];
  for (const [path, packageName, major, file] of cases) {
    const route = classifyPath(path);
    assert.equal(route.kind, 'major', path);
    assert.equal(route.packageName, packageName, path);
    assert.equal(route.major, major, path);
    assert.equal(route.file, file, path);
  }
});

test('floating aliases of known packages are marked alias', () => {
  for (const path of [
    '/loader@latest/loader.min.js',
    '/loader@2.5/loader.min.js',
    '/loader@next/cookies.min.js',
    '/modules@2',
    '/loader@1.x',
    '/loader@2.x',
  ]) {
    const route = classifyPath(path);
    assert.equal(route.kind, 'alias', path);
    assert.equal(route.packageName === 'loader' || route.packageName === 'modules', true);
  }
});

test('unknown packages and broken versions are invalid, not aliases', () => {
  assert.equal(classifyPath('/cli@2.5.0/stagepass.js').kind, 'invalid');
  assert.equal(classifyPath('/Loader@2.5.0/loader.min.js').kind, 'invalid');
  assert.equal(classifyPath('/loader@2.5.0').kind, 'invalid');
});

test('traversal, encoded separators, empty segments, and NUL are invalid', () => {
  const paths = [
    '/loader@2.5.0/../secrets.js',
    '/loader@2.5.0/foo/../../x.js',
    '/loader@2.5.0/%2e%2e/secrets.js',
    '/loader@2.5.0/%2E%2E/secrets.js',
    '/loader@2.5.0/%2fetc/passwd',
    '/loader@2.5.0/%2Fetc',
    '/loader@2.5.0/foo%5cbar.js',
    '/loader@2.5.0/foo%5Cbar.js',
    '/loader@2.5.0/%00.js',
    '/loader@2.5.0//loader.min.js',
    '/loader@2.5.0/./loader.min.js',
    '/loader@2.5.0/loader.min.js/',
    '/loader%402.5.0/loader%40.min.js',
    '/loader@2.5.0/loader.min.js\\x',
  ];
  for (const path of paths) {
    assert.equal(classifyPath(path).kind, 'invalid', path);
  }
});

test('sameAssetLocation accepts only the two forms of the same file', () => {
  const spec = classifyPath('/loader@2.5.0/loader.min.js');
  assert.equal(
    sameAssetLocation('/loader%402.5.0/loader.min.js', spec),
    '/loader%402.5.0/loader.min.js',
  );
  assert.equal(
    sameAssetLocation('https://cdn.stagepass.one/loader@2.5.0/loader.min.js?cache=1', spec),
    '/loader@2.5.0/loader.min.js',
  );
  assert.equal(sameAssetLocation('//evil.example/loader@2.5.0/loader.min.js', spec), null);
  assert.equal(sameAssetLocation('/modules@2.2.2/cookies.min.js', spec), null);
  assert.equal(sameAssetLocation('/loader%402.5.0/other.js', spec), null);
});
