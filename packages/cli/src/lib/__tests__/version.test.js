import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';

describe('CLI version', () => {
  it('bin reads version from package.json (not hard-coded 1.0.0)', () => {
    const require = createRequire(import.meta.url);
    const pkg = require('../../../package.json');
    const binPath = path.join(
      path.dirname(fileURLToPath(import.meta.url)),
      '../../../bin/index.js'
    );
    const binSource = readFileSync(binPath, 'utf-8');
    expect(binSource).not.toMatch(/\.version\(\s*['"]1\.0\.0['"]\s*\)/);
    expect(binSource).toMatch(/package\.json/);
    expect(pkg.version).toMatch(/^\d+\.\d+\.\d+/);
  });
});
