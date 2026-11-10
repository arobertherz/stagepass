import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  findPort443Conflict,
  resolvePort443Conflict,
  isSafePid,
  start,
} from '../start.js';

const okCerts = {
  root: { status: 'ok', reason: 'ok' },
  trust: { trusted: true },
  handshakes: [],
  orphans: [],
};

describe('start privilege / port safety', () => {
  /** @type {string[]} */
  const tempDirs = [];

  afterEach(() => {
    vi.restoreAllMocks();
    for (const dir of tempDirs.splice(0, tempDirs.length)) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('isSafePid rejects padded / zero / non-numeric values', () => {
    expect(isSafePid('123')).toBe(true);
    expect(isSafePid(123)).toBe(true);
    expect(isSafePid('0')).toBe(false);
    expect(isSafePid(' 12')).toBe(false);
    expect(isSafePid('12;rm')).toBe(false);
    expect(isSafePid('')).toBe(false);
  });

  it('findPort443Conflict uses argv lsof (no shell, no sudo)', async () => {
    /** @type {unknown[][]} */
    const calls = [];
    const exec = vi.fn(async (file, args = []) => {
      calls.push([file, args]);
      if (file === 'lsof') {
        return {
          stdout:
            'COMMAND PID USER FD TYPE DEVICE SIZE/OFF NODE NAME\nnginx 4242 me 8u IPv6 0x1 0t0 TCP *:443 (LISTEN)\n',
          stderr: '',
          code: 0,
        };
      }
      throw new Error(`unexpected ${file}`);
    });
    const conflict = await findPort443Conflict({ exec });
    expect(conflict).toEqual({ pid: '4242', name: 'nginx' });
    expect(calls[0][0]).toBe('lsof');
    expect(calls[0][1]).toEqual(['-nP', '-iTCP:443', '-sTCP:LISTEN']);
    expect(calls.every((c) => c[0] !== 'sudo')).toBe(true);
  });

  it('findPort443Conflict ignores caddy listeners', async () => {
    const exec = vi.fn(async () => ({
      stdout:
        'COMMAND PID USER FD TYPE DEVICE SIZE/OFF NODE NAME\ncaddy 9 me 8u IPv6 0x1 0t0 TCP *:443 (LISTEN)\n',
      stderr: '',
      code: 0,
    }));
    expect(await findPort443Conflict({ exec })).toBeNull();
  });

  it('resolvePort443Conflict: TERM then KILL only after second confirm', async () => {
    /** @type {string[]} */
    const signals = [];
    let listen = true;
    const exec = vi.fn(async (file, args = []) => {
      if (file === 'kill') {
        signals.push(`kill:${args.join(' ')}`);
        return { stdout: '', stderr: '', code: 0 };
      }
      if (file === 'sudo') {
        signals.push(`sudo:${args.join(' ')}`);
        return { stdout: '', stderr: '', code: 0 };
      }
      return { stdout: '', stderr: '', code: 0 };
    });
    const confirms = [];
    const result = await resolvePort443Conflict(
      { pid: '4242', name: 'OtherApp' },
      {
        exec,
        confirm: async (message) => {
          confirms.push(message);
          return true;
        },
        sleep: async () => {},
        recheck: async () => {
          if (listen) {
            listen = false;
            return { pid: '4242', name: 'OtherApp' };
          }
          return null;
        },
      }
    );
    expect(result.ok).toBe(true);
    expect(result.detail).toBe('SIGKILL');
    expect(confirms).toHaveLength(2);
    expect(confirms[0]).toMatch(/SIGTERM/);
    expect(confirms[1]).toMatch(/SIGKILL/);
    expect(signals.some((s) => s.includes('-TERM') || s.includes('TERM'))).toBe(
      true
    );
    expect(signals.some((s) => s.includes('-KILL') || s.includes('KILL'))).toBe(
      true
    );
    expect(signals.some((s) => /kill -9\b/.test(s))).toBe(false);
    // Own process: unprivileged kill first; no standby sudo -v
    expect(signals.some((s) => s === 'sudo:-v' || s.startsWith('sudo:-v '))).toBe(
      false
    );
    expect(signals.filter((s) => s.startsWith('kill:'))).toHaveLength(2);
  });

  it('resolvePort443Conflict uses sudo kill only after unprivileged kill fails', async () => {
    /** @type {string[]} */
    const signals = [];
    const exec = vi.fn(async (file, args = []) => {
      if (file === 'kill') {
        signals.push(`kill:${args.join(' ')}`);
        const err = new Error('Operation not permitted');
        Object.assign(err, { code: 'EPERM' });
        throw err;
      }
      if (file === 'sudo') {
        signals.push(`sudo:${args.join(' ')}`);
        return { stdout: '', stderr: '', code: 0 };
      }
      return { stdout: '', stderr: '', code: 0 };
    });
    const result = await resolvePort443Conflict(
      { pid: '4242', name: 'OtherApp' },
      {
        exec,
        confirm: async () => true,
        sleep: async () => {},
        recheck: async () => null,
      }
    );
    expect(result.ok).toBe(true);
    expect(result.detail).toBe('SIGTERM');
    expect(signals[0]).toBe('kill:-TERM 4242');
    expect(signals[1]).toBe('sudo:kill -TERM 4242');
    expect(signals.some((s) => s.includes('-v'))).toBe(false);
  });

  it('resolvePort443Conflict: nginx tries valet stop before any sudo', async () => {
    /** @type {string[][]} */
    const calls = [];
    const exec = vi.fn(async (file, args = []) => {
      calls.push([file, ...args]);
      if (file === 'valet') return { stdout: '', stderr: '', code: 0 };
      return { stdout: '', stderr: '', code: 0 };
    });
    const result = await resolvePort443Conflict(
      { pid: '7', name: 'nginx' },
      {
        exec,
        confirm: async () => true,
        sleep: async () => {},
        recheck: async () => null,
      }
    );
    expect(result.ok).toBe(true);
    expect(calls[0][0]).toBe('valet');
    expect(calls[0][1]).toBe('stop');
    expect(calls.every((c) => c[0] !== 'sudo')).toBe(true);
    expect(calls.every((c) => !(c[0] === 'sudo' && c[1] === '-v'))).toBe(true);
  });

  it('resolvePort443Conflict cancels without signalling when confirm is false', async () => {
    const exec = vi.fn(async () => {
      throw new Error('should not run');
    });
    const result = await resolvePort443Conflict(
      { pid: '4242', name: 'OtherApp' },
      {
        exec,
        confirm: async () => false,
        sleep: async () => {},
      }
    );
    expect(result).toEqual({ ok: false, cancelled: true });
    expect(exec).not.toHaveBeenCalled();
  });

  it('start does not call sudo -v and refuses noninteractive conflict kills', async () => {
    const calls = [];
    const exec = vi.fn(async (file, args = []) => {
      calls.push([file, ...(Array.isArray(args) ? args : [])]);
      if (file === 'lsof') {
        return {
          stdout:
            'COMMAND PID USER FD TYPE DEVICE SIZE/OFF NODE NAME\nnginx 7 me 8u IPv6 0x1 0t0 TCP *:443 (LISTEN)\n',
          stderr: '',
          code: 0,
        };
      }
      return { stdout: '', stderr: '', code: 0 };
    });
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    await start({
      exec,
      interactive: false,
      verbose: true,
      skipHandshake: true,
      runCertsCheck: async () => okCerts,
      findPort443Conflict: async () => ({ pid: '7', name: 'nginx' }),
    });
    expect(calls.some((c) => c[0] === 'sudo' && c[1] === '-v')).toBe(false);
    expect(
      logSpy.mock.calls
        .map((c) => c.join(' '))
        .join('\n')
    ).toMatch(/Refusing to signal without confirmation/);
  });

  it('start kickstarts LaunchAgent when loaded (no unconditional sudo)', async () => {
    const td = fs.mkdtempSync(path.join(os.tmpdir(), 'sp-start-'));
    tempDirs.push(td);
    const calls = [];
    const exec = vi.fn(async (file, args = []) => {
      calls.push([file, ...(Array.isArray(args) ? args : [])]);
      return { stdout: '', stderr: '', code: 0 };
    });
    vi.spyOn(console, 'log').mockImplementation(() => {});
    await start({
      exec,
      interactive: true,
      verbose: true,
      skipHandshake: true,
      runCertsCheck: async () => okCerts,
      findPort443Conflict: async () => null,
      getAutostartStatus: async () => ({
        loaded: true,
        plistExists: true,
        plistPath: path.join(td, 'agent.plist'),
      }),
      uid: 501,
    });
    expect(calls.some((c) => c[0] === 'sudo' && c[1] === '-v')).toBe(false);
  });
});

describe('start LaunchAgent kickstart wiring', () => {
  beforeEach(() => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('bootstraps then kickstarts when plist exists but not loaded', async () => {
    /** @type {string[][]} */
    const calls = [];
    const exec = vi.fn(async (file, args = []) => {
      calls.push([file, ...args]);
      if (file === 'brew') return { stdout: '', stderr: '', code: 0 };
      if (file === 'launchctl') return { stdout: '', stderr: '', code: 0 };
      return { stdout: '', stderr: '', code: 0 };
    });

    await start({
      exec,
      interactive: true,
      verbose: true,
      skipHandshake: true,
      runCertsCheck: async () => okCerts,
      findPort443Conflict: async () => null,
      getAutostartStatus: async () => ({
        loaded: false,
        plistExists: true,
        plistPath: '/tmp/io.github.arobertherz.stagepass.plist',
      }),
      uid: 501,
    });

    const joined = calls.map((c) => c.join(' '));
    expect(joined.some((l) => l.includes('bootstrap'))).toBe(true);
    expect(joined.some((l) => l.includes('kickstart'))).toBe(true);
    expect(joined.some((l) => l.startsWith('sudo -v'))).toBe(false);
  });

  it('falls back to direct caddy start when kickstart fails', async () => {
    const calls = [];
    const exec = vi.fn(async (file, args = []) => {
      calls.push([file, ...args]);
      if (file === 'launchctl' && args[0] === 'kickstart') {
        throw new Error('kickstart failed');
      }
      return { stdout: '', stderr: '', code: 0 };
    });
    await start({
      exec,
      interactive: true,
      verbose: true,
      skipHandshake: true,
      runCertsCheck: async () => okCerts,
      findPort443Conflict: async () => null,
      getAutostartStatus: async () => ({
        loaded: true,
        plistExists: true,
        plistPath: '/tmp/agent.plist',
      }),
      uid: 501,
    });
    expect(calls.some((c) => c[0] === 'caddy' && c[1] === 'start')).toBe(true);
  });
});
