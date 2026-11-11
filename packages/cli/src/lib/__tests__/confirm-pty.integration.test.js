/**
 * [AC-1] [AC-2] Shipped CLI under a real PTY (not a mocked ExitPromptError).
 *
 * Probed with util-linux `script` against `node packages/cli/bin/index.js`:
 * - Ctrl+C is byte 0x03. Readline raw mode (ISIG off) emits SIGINT on the
 *   interface. confirm() prints one "Aborted." and exits 130. bin/index.js
 *   uses Commander parse(), not parseAsync(); the catch inside confirm()
 *   calls process.exit, so the action promise does not need to be awaited.
 * - EOF at this prompt is not a kernel EOF. In raw mode 0x04 is just a byte;
 *   Node readline closes the line on Ctrl+D when the line is empty, and
 *   closing `script`'s stdin is forwarded as that same byte. @inquirer/core
 *   does not reject on readline "close"; signal-exit rejects with
 *   ExitPromptError "User force closed the prompt with 0 null" while the
 *   event loop drains. The catch still runs and the process exits 1 with
 *   one "Aborted." line.
 * - A non-TTY whose stdin is already closed never reaches a yes/no prompt:
 *   shipped confirms are gated on stdin.isTTY (certs trust refuses). That
 *   sub-case is not a product path; the library pipe is
 *   confirm-abort.integration.test.js.
 *
 * The reviewer Phase A file hung because every scenario shared one
 * Promise.all and runInteractive resolved only on 'close'. pipe-eof and
 * pipe-sigint are not TTYs, so watch/dev skip the prompt and spawn
 * `npm run watch` with stdio inherit. SIGKILL of the direct child leaves
 * that grandchild holding the pipes, so 'close' never fires. This file
 * resolves on 'exit', kills the process group, and only drives `certs trust`,
 * which does not spawn anything after an abort.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const BIN = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../bin/index.js'
);

const hasLinuxScript =
  process.platform === 'linux' &&
  spawnSync('script', ['--version'], { stdio: 'ignore' }).status === 0;

const skipNote = hasLinuxScript
  ? ''
  : process.platform === 'darwin'
    ? ' [skip: macOS BSD script is not used here; CI provides util-linux script -qefc]'
    : ' [skip: util-linux script is not installed]';

const STACK_RE =
  /ExitPromptError|User force closed|node:internal|\bat\s+\S+\.(?:m?js):\d+/;

function stripAnsi(s) {
  return String(s)
    .replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, '')
    .replace(/\x1b\][^\x07]*(?:\x07|\x1b\\)/g, '')
    .replace(/\r/g, '');
}

/** @type {number|null} */
let groupPid = null;

function killGroup(pid) {
  if (!pid) return;
  try {
    process.kill(-pid, 'SIGKILL');
  } catch {
    try {
      process.kill(pid, 'SIGKILL');
    } catch {
      /* already gone */
    }
  }
}

afterEach(() => {
  killGroup(groupPid);
  groupPid = null;
});

/**
 * @param {{ mode: 'ctrlc' | 'eof' }} opts
 */
function runCertsTrustAbort(opts) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sp-pty-'));
  const home = path.join(root, 'home');
  const binDir = path.join(root, 'bin');
  fs.mkdirSync(home, { recursive: true });
  fs.mkdirSync(binDir, { recursive: true });
  const calls = path.join(root, 'calls.log');
  fs.writeFileSync(calls, '');
  for (const name of ['sudo', 'osascript', 'security', 'launchctl', 'brew', 'lsof', 'caddy']) {
    fs.writeFileSync(
      path.join(binDir, name),
      `#!/bin/sh\necho "${name} $*" >> "$SP_CALLS"\nexit 1\n`,
      { mode: 0o755 }
    );
  }
  const q = (s) => `'${String(s).replace(/'/g, `'\\''`)}'`;
  const inner = [
    'sh',
    '-c',
    'stty rows 40 cols 120 2>/dev/null; exec "$@"',
    'sh',
    process.execPath,
    BIN,
    'certs',
    'trust',
  ];
  const child = spawn('script', ['-qefc', inner.map(q).join(' '), '/dev/null'], {
    detached: true,
    stdio: ['pipe', 'pipe', 'pipe'],
    env: {
      ...process.env,
      HOME: home,
      PATH: `${binDir}${path.delimiter}/usr/bin${path.delimiter}/bin`,
      STAGEPASS_SKIP_PLATFORM_CHECK: '1',
      NO_COLOR: '1',
      FORCE_COLOR: '0',
      SP_CALLS: calls,
      CI: '1',
    },
  });
  groupPid = child.pid ?? null;

  return new Promise((resolve) => {
    let out = '';
    let sent = false;
    let callsAtPrompt = '';
    let settled = false;
    const started = Date.now();
    const finish = (code, signal, timedOut) => {
      if (settled) return;
      settled = true;
      clearTimeout(hard);
      clearInterval(poll);
      const callsAfter = fs.readFileSync(calls, 'utf8');
      killGroup(child.pid);
      groupPid = null;
      resolve({
        code,
        signal,
        out,
        timedOut,
        callsAtPrompt,
        callsAfter,
        ms: Date.now() - started,
      });
    };
    const hard = setTimeout(() => finish(null, 'SIGKILL', true), 15000);
    child.stdout?.on('data', (d) => {
      out += d.toString('utf8');
    });
    child.stderr?.on('data', (d) => {
      out += d.toString('utf8');
    });
    child.stdin?.on('error', () => {});
    child.on('exit', (code, signal) => finish(code, signal, false));
    child.on('error', (err) => {
      out += String(err);
      finish(null, null, false);
    });
    const poll = setInterval(() => {
      if (sent || settled) return;
      if (!/caddy trust/.test(stripAnsi(out))) return;
      sent = true;
      callsAtPrompt = fs.readFileSync(calls, 'utf8');
      if (opts.mode === 'ctrlc') child.stdin.write(Buffer.from([0x03]));
      else child.stdin.write(Buffer.from([0x04]));
    }, 20);
  });
}

function assertAbort(result, code) {
  const plain = stripAnsi(result.out);
  expect(result.timedOut, plain).toBe(false);
  expect(result.code, plain).toBe(code);
  expect(plain.split('Aborted.').length - 1).toBe(1);
  expect(plain).not.toMatch(STACK_RE);
  expect(result.callsAtPrompt).not.toMatch(/\bcaddy trust\b/);
  expect(result.callsAfter).toBe(result.callsAtPrompt);
  expect(result.ms).toBeLessThan(15000);
}

describe('shipped confirm abort on a PTY', () => {
  it.skipIf(!hasLinuxScript)(
    `[AC-1] Ctrl+C at certs trust prints Aborted. once, exit 130, no action${skipNote}`,
    async () => {
      const result = await runCertsTrustAbort({ mode: 'ctrlc' });
      assertAbort(result, 130);
    },
    20000
  );

  it.skipIf(!hasLinuxScript)(
    `[AC-2] EOF (byte 0x04) at certs trust prints Aborted. once, exit 1, no action${skipNote}`,
    async () => {
      const result = await runCertsTrustAbort({ mode: 'eof' });
      assertAbort(result, 1);
    },
    20000
  );
});
