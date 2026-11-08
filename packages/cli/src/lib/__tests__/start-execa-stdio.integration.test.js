import { describe, it, expect, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runChildBounded } from './run-child-bounded.js';

const DIR = path.dirname(fileURLToPath(import.meta.url));
const HARNESS = path.join(DIR, 'start-execa-stdio-harness.mjs');
const OUTPUT_BUDGET = 64 * 1024;
const DEADLINE_MS = 2500;

/** @type {string[]} */
const tempDirs = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0, tempDirs.length)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe('public start path: execa@8 + logfile FD', () => {
  it(
    'caddy start that daemonizes with inherited log FDs settles without hang',
    async () => {
      const td = fs.mkdtempSync(path.join(os.tmpdir(), 'sp-start-fd-'));
      tempDirs.push(td);
      const fakeCaddy = path.join(td, 'caddy');
      const logFile = path.join(td, 'server.log');
      fs.writeFileSync(
        fakeCaddy,
        `#!/usr/bin/env node
import { spawn } from 'node:child_process';
if (process.argv[2] === 'stop') process.exit(0);
if (process.argv[2] === 'start') {
  const child = spawn(process.execPath, ['-e', 'setInterval(()=>{}, 1000)'], {
    stdio: ['ignore', 'inherit', 'inherit'],
    detached: true,
  });
  child.unref();
  process.exit(0);
}
process.exit(1);
`,
        { mode: 0o755 }
      );

      const result = await runChildBounded({
        args: [
          HARNESS,
          `--caddy=${fakeCaddy}`,
          `--log=${logFile}`,
        ],
        deadlineMs: DEADLINE_MS,
        outputBudget: OUTPUT_BUDGET,
        label: 'execa-start-fd',
        // Resolve `execa` from the CLI package / workspace install.
        cwd: path.resolve(DIR, '../../..'),
      });
      expect(result.timedOut, result.output).toBe(false);
      expect(result.capped).toBe(false);
      expect(result.code).toBe(0);
      expect(result.output).toContain('START_FD_OK');
      expect(result.aliveAfterClose).toBe(false);
    },
    8_000
  );
});
