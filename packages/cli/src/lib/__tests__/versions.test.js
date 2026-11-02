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
  it.each(['loader', 'modules'])('matches packages/%s/package.json', (dir) => {
    const pkg = JSON.parse(
      fs.readFileSync(path.join(packagesDir, dir, 'package.json'), 'utf8')
    );
    expect(STAGEPASS_PACKAGES_VERSION).toBe(pkg.version);
  });

  it('builds a major.minor caret range (npm would otherwise keep resolving the older latest tag)', () => {
    expect(packagesRange('2.2.0')).toBe('^2.2.0');
    expect(packagesRange('3.0.4')).toBe('^3.0.0');
    expect(packagesRange('^3.4.5')).toBe('^3.4.0');
    expect(packagesRange()).toMatch(/^\^\d+\.\d+\.0$/);
    expect(() => packagesRange('latest')).toThrow();
  });
});
