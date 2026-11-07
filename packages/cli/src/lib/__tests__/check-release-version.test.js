import { describe, it, expect } from 'vitest';
import {
  parseReleaseTag,
  distTagForVersion,
  readPackageVersions,
  releasePlan,
} from '../../../../../scripts/check-release-version.mjs';
import path from 'path';
import { fileURLToPath } from 'url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '../../../../../');

describe('check-release-version', () => {
  it('parses package-specific release tags', () => {
    expect(parseReleaseTag('modules-v2.0.0-beta.1')).toEqual({
      dir: 'modules',
      version: '2.0.0-beta.1',
    });
    expect(parseReleaseTag('loader-v2.3.3')).toEqual({ dir: 'loader', version: '2.3.3' });
    expect(parseReleaseTag('cli-v2.2.6')).toEqual({ dir: 'cli', version: '2.2.6' });
  });

  it('picks next for prereleases and latest otherwise', () => {
    expect(distTagForVersion('2.0.0-beta.1')).toBe('next');
    expect(distTagForVersion('2.2.0')).toBe('next');
  });

  it('stages only the named package when its version matches the tag', () => {
    const packages = readPackageVersions(ROOT);
    expect(packages).toHaveLength(3);
    for (const pkg of packages) {
      const plan = releasePlan(`${pkg.dir}-v${pkg.version}`, ROOT);
      expect(plan.stage.map((item) => item.dir)).toEqual([pkg.dir]);
      expect(plan.stage.length + plan.skip.length).toBe(3);
    }
  });

  it('fails closed when the package version does not match the tag', () => {
    expect(() => releasePlan('modules-v0.0.0-never', ROOT)).toThrow(/does not match tag version/);
  });

  it('fails closed on a shared v-tag or an unknown package tag', () => {
    const packages = readPackageVersions(ROOT);
    const cli = packages.find((pkg) => pkg.dir === 'cli');
    expect(() => releasePlan(`v${cli.version}`, ROOT)).toThrow(/Not a package release tag/);
    expect(() => releasePlan('v2.2.2', ROOT)).toThrow(/Not a package release tag/);
    expect(() => releasePlan('unknown-v1.0.0', ROOT)).toThrow(/Not a package release tag/);
    expect(() => releasePlan('foo-v2.2.2', ROOT)).toThrow(/Not a package release tag/);
  });
});
