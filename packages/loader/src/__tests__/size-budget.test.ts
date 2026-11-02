import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { gzipSync } from 'zlib';
import path from 'path';
import { fileURLToPath } from 'url';

/**
 * Size budget for what every visitor of a live site downloads.
 * dist/ is built before tests in CI (and committed for the CDN).
 * Raise these limits only on purpose.
 */
const BUDGET = {
  'loader.min.js': { min: 13824, gzip: 6272 },
  // Dev-only chunks, fetched only while a Stagepass session is active
  'flag.min.js': { min: 6528, gzip: 2816 },
  // Fetched by the flag on the first expand
  'flag-card.min.js': { min: 12288, gzip: 5120 },
};

const dist = path.join(path.dirname(fileURLToPath(import.meta.url)), '../../dist');

describe('size budget', () => {
  for (const [file, limit] of Object.entries(BUDGET)) {
    it(`${file} stays within ${limit.min} B min / ${limit.gzip} B gzip`, () => {
      const buf = readFileSync(path.join(dist, file));
      const gz = gzipSync(buf, { level: 9 }).length;
      expect(buf.length, `${file} minified bytes`).toBeLessThanOrEqual(limit.min);
      expect(gz, `${file} gzip bytes`).toBeLessThanOrEqual(limit.gzip);
    });
  }

  it('bundles contain no eval, Function constructor or innerHTML', () => {
    for (const file of Object.keys(BUDGET)) {
      const src = readFileSync(path.join(dist, file), 'utf-8');
      expect(src).not.toMatch(/\beval\(|new Function\(|innerHTML|outerHTML|insertAdjacentHTML|document\.write/);
    }
  });
});
