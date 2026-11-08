/**
 * Bounded spinner harness. Modes: cols0 | geometry80x24 | invalid | resize80to0
 * Impl: safe (createSpinner) | raw-ora (defective fixture, no width clamp)
 *
 * Sync Infinity clear loops are expected only for raw-ora + unsafe geometry;
 * the parent test must SIGTERM/SIGKILL and enforce an output budget.
 */
import { PassThrough } from 'node:stream';
import ora from 'ora';
import { createSpinner } from '../spinner.js';

const OUTPUT_BUDGET = 64 * 1024;

function parseArgs(argv) {
  /** @type {Record<string, string>} */
  const out = {};
  for (const arg of argv) {
    const m = /^--([^=]+)=(.*)$/.exec(arg);
    if (m) out[m[1]] = m[2];
  }
  return out;
}

const args = parseArgs(process.argv.slice(2));
const mode = args.mode || 'cols0';
const impl = args.impl || 'safe';
const text = 'Booting background services...';

/** @type {import('node:stream').Writable & { columns?: number, rows?: number, isTTY?: boolean }} */
let stream;
/** @type {{ columns: number, rows: number }|null} */
let geometry = null;
let bytes = 0;

if (mode === 'pty-native') {
  // Real TTY under `script` (or similar). Do not mock columns.
  stream = process.stderr;
} else {
  geometry = {
    columns:
      mode === 'geometry80x24' || mode === 'resize80to0'
        ? 80
        : mode === 'invalid'
          ? Number.POSITIVE_INFINITY
          : 0,
    rows: mode === 'geometry80x24' || mode === 'resize80to0' ? 24 : 0,
  };
  stream = new PassThrough();
  stream.isTTY = true;
  Object.defineProperty(stream, 'columns', {
    configurable: true,
    get: () => geometry.columns,
  });
  Object.defineProperty(stream, 'rows', {
    configurable: true,
    get: () => geometry.rows,
  });
  stream.cursorTo = () => {};
  stream.moveCursor = () => {};
  // Safe path: no-op clears (we only assert bounded exit).
  // Raw-ora path: each clearLine emits a byte so the ora@7 cols=0 Infinity
  // clear loop is observable to the parent's output budget (and CI!=TTY).
  stream.clearLine =
    impl === 'raw-ora'
      ? () => {
          stream.write('x');
        }
      : () => {};
  stream.on('data', (chunk) => {
    bytes += chunk.length;
    if (bytes > OUTPUT_BUDGET) {
      process.stderr.write(`HARNESS_OVERFLOW bytes=${bytes}\n`);
      process.exit(2);
    }
  });
}

const spinner =
  impl === 'raw-ora'
    ? // Force the enabled spinner path: under CI, is-interactive() is false and
      // ora would otherwise no-op, skip the cols=0 clear loop, and print HARNESS_OK.
      // Geometry still comes from stream.columns === 0 (ora uses `columns ?? 80`).
      ora({ text, stream, discardStdin: false, isEnabled: true })
    : createSpinner(text, { stream, discardStdin: false });

spinner.start();
await new Promise((r) => setTimeout(r, 25));

if (mode === 'resize80to0' && geometry) {
  geometry.columns = 0;
  geometry.rows = 0;
  spinner.text = text;
  await new Promise((r) => setTimeout(r, 40));
}

if (
  mode === 'invalid' ||
  mode === 'cols0' ||
  mode === 'geometry80x24' ||
  mode === 'pty-native'
) {
  await new Promise((r) => setTimeout(r, 30));
}

spinner.succeed('done');
const cols =
  mode === 'pty-native'
    ? (process.stderr.columns ?? process.stdout.columns ?? 'na')
    : geometry?.columns;
process.stdout.write(
  `HARNESS_OK impl=${impl} mode=${mode} bytes=${bytes} cols=${cols}\n`
);
process.exit(0);
