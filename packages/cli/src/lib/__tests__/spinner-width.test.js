import { describe, it, expect } from 'vitest';
import { PassThrough } from 'node:stream';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  resolveSpinnerColumns,
  withSafeGeometry,
} from '../spinner.js';
import { runChildBounded } from './run-child-bounded.js';

const OUTPUT_BUDGET = 64 * 1024;
const CHILD_DEADLINE_MS = 2500;
const DIR = path.dirname(fileURLToPath(import.meta.url));
const HARNESS = path.join(DIR, 'spinner-ora-harness.mjs');
const SCRIPT_BIN = '/usr/bin/script';

/**
 * @param {{ columns?: number, rows?: number, isTTY?: boolean }} geometry
 */
function mockTtyStream(geometry) {
  const stream = new PassThrough();
  stream.isTTY = geometry.isTTY !== false;
  Object.defineProperty(stream, 'columns', {
    configurable: true,
    get: () => geometry.columns,
  });
  Object.defineProperty(stream, 'rows', {
    configurable: true,
    get: () => geometry.rows,
  });
  stream.clearLine = () => {};
  stream.cursorTo = () => {};
  stream.moveCursor = () => {};
  return stream;
}

/**
 * @param {string[]} extraArgs
 * @param {string} label
 */
async function runHarness(extraArgs, label) {
  const result = await runChildBounded({
    args: [HARNESS, ...extraArgs],
    deadlineMs: CHILD_DEADLINE_MS,
    outputBudget: OUTPUT_BUDGET,
    label,
  });
  expect(result.aliveAfterClose, `${label} must not leave a live child`).toBe(
    false
  );
  return result;
}

describe('spinner width safety', () => {
  it('mock: resolveSpinnerColumns falls back for 0 / invalid / sub-1 widths', () => {
    expect(resolveSpinnerColumns(0)).toBe(80);
    expect(resolveSpinnerColumns(0.5)).toBe(80);
    expect(resolveSpinnerColumns(-1)).toBe(80);
    expect(resolveSpinnerColumns(Number.NaN)).toBe(80);
    expect(resolveSpinnerColumns(Number.POSITIVE_INFINITY)).toBe(80);
    expect(resolveSpinnerColumns(undefined)).toBe(80);
    expect(resolveSpinnerColumns(120)).toBe(120);
    expect(resolveSpinnerColumns(3.9)).toBe(3);
  });

  it('mock: withSafeGeometry keeps live columns safe after 80→0 resize', () => {
    const geometry = { columns: 80, rows: 24 };
    const stream = mockTtyStream(geometry);
    const safe = withSafeGeometry(stream);
    expect(safe.columns).toBe(80);
    geometry.columns = 0;
    geometry.rows = 0;
    expect(safe.columns).toBe(80);
    expect(safe.rows).toBe(24);
  });

  it(
    'child: createSpinner mock cols=0 stays bounded',
    async () => {
      const result = await runHarness(
        ['--mode=cols0', '--impl=safe'],
        'safe-cols0'
      );
      expect(result.timedOut).toBe(false);
      expect(result.capped).toBe(false);
      expect(result.code).toBe(0);
      expect(result.bytes).toBeLessThanOrEqual(OUTPUT_BUDGET);
      expect(result.output).toContain('HARNESS_OK');
    },
    8_000
  );

  it(
    'child: createSpinner mock geometry80x24 stays bounded',
    async () => {
      const result = await runHarness(
        ['--mode=geometry80x24', '--impl=safe'],
        'safe-80x24'
      );
      expect(result.timedOut).toBe(false);
      expect(result.capped).toBe(false);
      expect(result.code).toBe(0);
      expect(result.bytes).toBeLessThanOrEqual(OUTPUT_BUDGET);
      expect(result.output).toContain('HARNESS_OK');
    },
    8_000
  );

  it(
    'child: createSpinner mock invalid columns stays bounded',
    async () => {
      const result = await runHarness(
        ['--mode=invalid', '--impl=safe'],
        'safe-invalid'
      );
      expect(result.timedOut).toBe(false);
      expect(result.capped).toBe(false);
      expect(result.code).toBe(0);
      expect(result.bytes).toBeLessThanOrEqual(OUTPUT_BUDGET);
      expect(result.output).toContain('HARNESS_OK');
    },
    8_000
  );

  it(
    'child: createSpinner mock resize 80→0 stays bounded',
    async () => {
      const result = await runHarness(
        ['--mode=resize80to0', '--impl=safe'],
        'safe-resize80to0'
      );
      expect(result.timedOut).toBe(false);
      expect(result.capped).toBe(false);
      expect(result.code).toBe(0);
      expect(result.bytes).toBeLessThanOrEqual(OUTPUT_BUDGET);
      expect(result.output).toContain('HARNESS_OK');
    },
    8_000
  );

  it(
    'child: defective raw-ora cols=0 fixture aborted by deadline or output cap',
    async () => {
      const result = await runHarness(
        ['--mode=cols0', '--impl=raw-ora'],
        'raw-ora-cols0'
      );
      // Must not complete successfully: parent deadline/outputcap (or child overflow exit).
      // Fixture forces isEnabled + cols=0 so ora@7 clear loop runs even when CI=true.
      expect(result.output.includes('HARNESS_OK')).toBe(false);
      expect(
        result.timedOut ||
          result.capped ||
          result.code === 2 ||
          result.signal === 'SIGTERM' ||
          result.signal === 'SIGKILL'
      ).toBe(true);
      expect(result.bytes).toBeLessThanOrEqual(OUTPUT_BUDGET + 4096);
      expect(result.aliveAfterClose).toBe(false);
    },
    8_000
  );

  it(
    'child: linux script PTY createSpinner bounded when /usr/bin/script exists',
    async () => {
      if (!fs.existsSync(SCRIPT_BIN)) {
        return;
      }
      // util-linux/bsd `script` provides a PTY without extra installs.
      const result = await runChildBounded({
        command: SCRIPT_BIN,
        args: [
          '-q',
          '-c',
          `${process.execPath} ${HARNESS} --mode=pty-native --impl=safe`,
          '/dev/null',
        ],
        deadlineMs: CHILD_DEADLINE_MS,
        outputBudget: OUTPUT_BUDGET,
        label: 'script-pty-safe',
      });
      expect(result.aliveAfterClose).toBe(false);
      expect(result.timedOut).toBe(false);
      expect(result.capped).toBe(false);
      expect(result.code).toBe(0);
      expect(result.output).toContain('HARNESS_OK');
      expect(result.bytes).toBeLessThanOrEqual(OUTPUT_BUDGET);
    },
    8_000
  );
});
