import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { STAGEPASS_PACKAGES_VERSION, packagesRange } from '../versions.js';

const packagesDir = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../..'
);

describe('STAGEPASS_PACKAGES_VERSION', () => {
  const readVersion = (dir) =>
    JSON.parse(fs.readFileSync(path.join(packagesDir, dir, 'package.json'), 'utf8')).version;
  const core = (v) => v.split('-')[0].split('.').map(Number);

  it('matches packages/modules/package.json', () => {
    expect(STAGEPASS_PACKAGES_VERSION).toBe(readVersion('modules'));
  });

  // The loader may run ahead (minor/prerelease) within the same major: the CLI
  // scaffolds `^major`, so any loader 2.x satisfies it.
  it('stays within the loader major and never ahead of it', () => {
    const [lMaj, lMin, lPatch] = core(readVersion('loader'));
    const [cMaj, cMin, cPatch] = core(STAGEPASS_PACKAGES_VERSION);
    expect(lMaj).toBe(cMaj);
    expect(lMin * 1e6 + lPatch).toBeGreaterThanOrEqual(cMin * 1e6 + cPatch);
  });

  it('builds the major range (never a minor that may only be staged)', () => {
    expect(packagesRange('2.2.0')).toBe('^2');
    expect(packagesRange('3.0.4')).toBe('^3');
    expect(packagesRange('^3.4.5')).toBe('^3');
    expect(packagesRange()).toBe('^2');
    expect(() => packagesRange('latest')).toThrow();
    expect(() => packagesRange('2.2.0"; rm')).toThrow();
  });
});
