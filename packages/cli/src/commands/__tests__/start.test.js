import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  findPort443Conflict,
  resolvePort443Conflict,
  summarizeCertFindings,
  isSafePid,
  start,
} from '../start.js';
import { LAUNCH_AGENT_LABEL } from '../../lib/autostart.js';

describe('start helpers', () => {
  it('summarizes cert findings including orphans', () => {
    const findings = summarizeCertFindings({
      root: { status: 'ok', reason: 'ok' },
      trust: { trusted: false },
      handshakes: [{ status: 'fail', servername: 'a.sp', reason: 'bad' }],
      orphans: [{ sha1: 'AA' }],
    });
    expect(findings.some((f) => f.kind === 'trust')).toBe(true);
    expect(findings.some((f) => f.kind === 'site')).toBe(true);
    expect(findings.some((f) => f.kind === 'orphans')).toBe(true);
  });

  it('exports isSafePid', () => {
    expect(isSafePid('42')).toBe(true);
    expect(isSafePid('01')).toBe(false);
  });

  it('findPort443Conflict returns name and pid from lsof', async () => {
    const conflict = await findPort443Conflict({
      exec: async () => ({
        stdout: `COMMAND PID USER FD TYPE DEVICE SIZE/OFF NODE NAME
nginx   4242 me  8u IPv6 0x1 0t0 TCP *:443 (LISTEN)
`,
        stderr: '',
        code: 0,
      }),
    });
    expect(conflict).toEqual({ pid: '4242', name: 'nginx' });
  });

  it('resolvePort443Conflict requires confirm; httpd may use apachectl without sudo -v', async () => {
    const calls = [];
    const confirms = [];
    const result = await resolvePort443Conflict(
      { pid: '99', name: 'httpd' },
      {
        exec: async (file, args) => {
          calls.push({ file, args });
          return { stdout: '', stderr: '', code: 0 };
        },
        confirm: async (message) => {
          confirms.push(message);
          return true;
        },
        sleep: async () => {},
        recheck: async () =>
          confirms.length === 1 ? { pid: '99', name: 'httpd' } : null,
      }
    );
    expect(result.ok).toBe(true);
    expect(confirms[0]).toMatch(/PID 99/);
    expect(confirms[0]).toMatch(/httpd/);
    expect(calls.some((c) => c.file === 'sudo' && c.args[0] === '-v')).toBe(
      false
    );
    expect(
      calls.some(
        (c) =>
          c.file === 'sudo' &&
          c.args[0] === 'apachectl' &&
          c.args[1] === 'stop'
      )
    ).toBe(true);
    expect(confirms.length).toBeGreaterThanOrEqual(1);
  });

  it('refuses sudo/kill when proc.pid is not a positive integer', async () => {
    const calls = [];
    const confirm = vi.fn(async () => true);
    for (const badPid of ['0', '-1', '12;rm', 'abc', '', '01', null, undefined]) {
      calls.length = 0;
      confirm.mockClear();
      const result = await resolvePort443Conflict(
        { pid: badPid, name: 'evil' },
        {
          exec: async (file, args) => {
            calls.push({ file, args });
            return { stdout: '', stderr: '', code: 0 };
          },
          confirm,
        }
      );
      expect(result.ok).toBe(false);
      expect(result.detail).toMatch(/invalid PID/i);
      expect(confirm).not.toHaveBeenCalled();
      expect(calls).toHaveLength(0);
    }
  });

  it('escalates to SIGKILL only after second confirmation (unprivileged kill first)', async () => {
    const calls = [];
    const confirms = [];
    const result = await resolvePort443Conflict(
      { pid: '55', name: 'otherd' },
      {
        exec: async (file, args) => {
          calls.push({ file, args });
          return { stdout: '', stderr: '', code: 0 };
        },
        confirm: async (message) => {
          confirms.push(message);
          return true;
        },
        sleep: async () => {},
        recheck: async () =>
          confirms.length < 2 ? { pid: '55', name: 'otherd' } : null,
      }
    );
    expect(result.ok).toBe(true);
    expect(result.detail).toBe('SIGKILL');
    expect(confirms).toHaveLength(2);
    expect(
      calls.some(
        (c) =>
          c.file === 'kill' &&
          c.args[0] === '-KILL' &&
          c.args[1] === '55'
      )
    ).toBe(true);
    expect(calls.every((c) => !(c.file === 'sudo' && c.args[0] === '-v'))).toBe(
      true
    );
  });

  it('SIGTERM-only path when process exits after first signal', async () => {
    const calls = [];
    const result = await resolvePort443Conflict(
      { pid: '77', name: 'otherd' },
      {
        exec: async (file, args) => {
          calls.push({ file, args });
          return { stdout: '', stderr: '', code: 0 };
        },
        confirm: async () => true,
        sleep: async () => {},
        recheck: async () => null,
      }
    );
    expect(result.ok).toBe(true);
    expect(result.detail).toBe('SIGTERM');
    expect(
      calls.some(
        (c) =>
          c.file === 'kill' &&
          c.args[0] === '-TERM' &&
          c.args[1] === '77'
      )
    ).toBe(true);
    expect(calls.every((c) => !(c.args || []).includes('-KILL'))).toBe(true);
    expect(calls.every((c) => !(c.file === 'sudo' && c.args[0] === '-v'))).toBe(
      true
    );
  });
});

describe('start autostart / certs integration', () => {
  let logSpy;

  beforeEach(() => {
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('uses launchctl kickstart when LaunchAgent is loaded', async () => {
    const calls = [];
    await start({
      verbose: true,
      interactive: false,
      skipHandshake: true,
      exec: async (file, args) => {
        calls.push({ file, args });
        return { stdout: '', stderr: '', code: 0 };
      },
      runCertsCheck: async () => ({
        root: { status: 'ok', reason: 'ok' },
        trust: { trusted: true },
        handshakes: [],
        orphans: [],
      }),
      findPort443Conflict: async () => null,
      getAutostartStatus: async () => ({
        loaded: true,
        plistExists: true,
        plistPath: '/tmp/agent.plist',
      }),
      uid: 501,
    });
    expect(
      calls.some(
        (c) =>
          c.file === 'launchctl' &&
          c.args[0] === 'kickstart' &&
          c.args[1] === '-k' &&
          c.args[2] === `gui/501/${LAUNCH_AGENT_LABEL}`
      )
    ).toBe(true);
    const joined = logSpy.mock.calls.map((c) => c.join(' ')).join('\n');
    expect(joined).toMatch(/kickstart/);
  });

  it('prints cert findings and hint when non-interactive', async () => {
    await start({
      verbose: true,
      interactive: false,
      skipHandshake: true,
      exec: async () => ({ stdout: '', stderr: '', code: 0 }),
      runCertsCheck: async () => ({
        root: { status: 'ok', reason: 'ok' },
        trust: { trusted: false },
        handshakes: [],
        orphans: [],
      }),
      findPort443Conflict: async () => null,
      getAutostartStatus: async () => ({
        loaded: false,
        plistExists: false,
      }),
    });
    const joined = logSpy.mock.calls.map((c) => c.join(' ')).join('\n');
    expect(joined).toMatch(/Certificate findings/);
    expect(joined).toMatch(/Non-interactive start/);
  });
});
