import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';

describe('CLI version', () => {
  it('cli reads version from package.json (not hard-coded 1.0.0)', () => {
    const require = createRequire(import.meta.url);
    const pkg = require('../../../package.json');
    const cliPath = path.join(
      path.dirname(fileURLToPath(import.meta.url)),
      '../../cli.js'
    );
    const cliSource = readFileSync(cliPath, 'utf-8');
    expect(cliSource).not.toMatch(/\.version\(\s*['"]1\.0\.0['"]\s*\)/);
    expect(cliSource).toMatch(/package\.json/);
    expect(pkg.version).toMatch(/^\d+\.\d+\.\d+/);
  });
});
