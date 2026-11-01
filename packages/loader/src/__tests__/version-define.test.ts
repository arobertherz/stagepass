import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { createRequire } from 'module';
import { fileURLToPath } from 'url';
import path from 'path';

describe('build-time version', () => {
  it('tsup config defines __STAGEPASS_VERSION__ from package.json', () => {
    const require = createRequire(import.meta.url);
    const pkg = require('../../package.json');
    const cfg = readFileSync(
      path.join(path.dirname(fileURLToPath(import.meta.url)), '../../tsup.config.ts'),
      'utf-8'
    );
    expect(cfg).toMatch(/__STAGEPASS_VERSION__/);
    expect(pkg.version).toBeTruthy();
  });
});
