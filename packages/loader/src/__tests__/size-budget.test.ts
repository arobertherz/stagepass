import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { brotliCompressSync, constants, gzipSync } from 'zlib';
import path from 'path';
import { fileURLToPath } from 'url';

/**
 * Size budget for what every visitor of a live site downloads.
 * dist/ is built before tests in CI (and committed for the CDN).
 * Raise these limits only on purpose.
 * 2.3.0 loader.min.js: 13395 B min / 6067 B gzip / 5407 B brotli.
 * 2.3.1 adds flag base resolution (loader folder, option, fallback): 13798 / 6257 / 5588.
 * Unreleased (core slim): live hook, vars debug hint and duplicate-path warnings moved into
 * flag.min.js; live-src keeps a minimal MutationObserver / beforescriptexecute hook in the
 * core (must run before the parser prepares a script). Measured loader.min.js
 * 14882 / 6566 / 5866; flag.min.js 7404 / 3216 / 2802; flag-card 11894 / 4936 / 4341;
 * live.min.js 1485 / 811 / 703. Budgets = measured + at most 64 B headroom.
 * data-stagepass-nocache replaces an existing `_cb` in the query string only.
 * Measured loader.min.js 15065 / 6664 / 5958 (min / gzip / brotli); 2.4.0 was
 * 14852 / 6562 / 5856. The previous nocache freeze was 15006 / 6621 / 5910.
 * flag.min.js / flag-card.min.js / live.min.js are unchanged.
 */
const BUDGET = {
  'loader.min.js': { min: 15070, gzip: 6685, br: 5974 },
  // Dev-only chunks, fetched only while a Stagepass session is active
  'flag.min.js': { min: 7468, gzip: 3280, br: 2866 },
  // Fetched by the flag on the first expand
  'flag-card.min.js': { min: 11958, gzip: 5000, br: 4405 },
  // Live reload EventSource client (swap session only; bootstrapped by the flag chunk)
  'live.min.js': { min: 1549, gzip: 875, br: 767 },
};

const dist = path.join(path.dirname(fileURLToPath(import.meta.url)), '../../dist');

describe('size budget', () => {
  for (const [file, limit] of Object.entries(BUDGET)) {
    it(`${file} stays within ${limit.min} B min / ${limit.gzip} B gzip / ${limit.br} B brotli`, () => {
      const buf = readFileSync(path.join(dist, file));
      const gz = gzipSync(buf, { level: 9 }).length;
      const br = brotliCompressSync(buf, { params: { [constants.BROTLI_PARAM_QUALITY]: 11 } }).length;
      expect(buf.length, `${file} minified bytes`).toBeLessThanOrEqual(limit.min);
      expect(gz, `${file} gzip bytes`).toBeLessThanOrEqual(limit.gzip);
      expect(br, `${file} brotli bytes`).toBeLessThanOrEqual(limit.br);
    });
  }

  it('bundles contain no eval, Function constructor or innerHTML', () => {
    for (const file of Object.keys(BUDGET)) {
      const src = readFileSync(path.join(dist, file), 'utf-8');
      expect(src).not.toMatch(/\beval\(|new Function\(|innerHTML|outerHTML|insertAdjacentHTML|document\.write/);
    }
  });
});
