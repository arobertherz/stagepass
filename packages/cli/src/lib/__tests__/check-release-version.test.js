import { describe, it, expect } from 'vitest';
import {
  normalizeTagVersion,
  checkReleaseVersion,
  distTagForVersion,
  readPackageVersions,
} from '../../../../../scripts/check-release-version.mjs';
import path from 'path';
import { fileURLToPath } from 'url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '../../../../../');

describe('check-release-version', () => {
  it('normalizes leading v', () => {
    expect(normalizeTagVersion('v2.0.0-beta.1')).toBe('2.0.0-beta.1');
    expect(normalizeTagVersion('2.0.0-beta.1')).toBe('2.0.0-beta.1');
  });

  it('picks next for prereleases and latest otherwise', () => {
    expect(distTagForVersion('2.0.0-beta.1')).toBe('next');
    expect(distTagForVersion('2.0.0')).toBe('latest');
  });

  it('passes when all package versions match the tag', () => {
    const packages = readPackageVersions(ROOT);
    expect(packages).toHaveLength(3);
    const version = packages[0].version;
    const result = checkReleaseVersion(`v${version}`, ROOT);
    // Only passes if all three already share the same version
    if (packages.every((p) => p.version === version)) {
      expect(result.ok).toBe(true);
    }
  });

  it('fails when tag does not match', () => {
    const result = checkReleaseVersion('v0.0.0-never', ROOT);
    expect(result.ok).toBe(false);
    expect(result.mismatches.length).toBeGreaterThan(0);
  });
});
