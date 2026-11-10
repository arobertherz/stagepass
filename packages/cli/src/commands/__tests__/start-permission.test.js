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
import { certsCheck } from '../certs.js';
import { runDoctor } from '../../lib/doctor.js';

const okCerts = {
  root: { status: 'ok', reason: 'ok' },
  trust: { trusted: true },
  handshakes: [],
  orphans: [],
};

/** @param {unknown[][]} calls */
function assertNoSudo(calls) {
  const sudo = calls.filter((c) => c[0] === 'sudo');
  expect(sudo, `unexpected sudo calls: ${JSON.stringify(sudo)}`).toEqual([]);
}

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
    /** @type {Array<[number, string]>} */
    const kills = [];
    let listen = true;
    const exec = vi.fn(async (file, args = []) => {
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
        kill: (pid, sig) => {
          kills.push([pid, String(sig)]);
          return true;
        },
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
    expect(kills).toEqual([
      [4242, 'SIGTERM'],
      [4242, 'SIGKILL'],
    ]);
    expect(signals.some((s) => /kill -9\b/.test(s))).toBe(false);
    // Own process: unprivileged kill first; no standby sudo -v
    expect(signals.some((s) => s === 'sudo:-v' || s.startsWith('sudo:-v '))).toBe(
      false
    );
  });

  it('resolvePort443Conflict uses sudo kill only after unprivileged kill fails', async () => {
    /** @type {string[]} */
    const signals = [];
    const exec = vi.fn(async (file, args = []) => {
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
        kill: () => {
          const err = new Error('Operation not permitted');
          Object.assign(err, { code: 'EPERM' });
          throw err;
        },
        confirm: async () => true,
        sleep: async () => {},
        recheck: async () => null,
      }
    );
    expect(result.ok).toBe(true);
    expect(result.detail).toBe('SIGTERM');
    expect(signals[0]).toBe('sudo:kill -TERM 4242');
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

describe('start privilege model [F-04]', () => {
  beforeEach(() => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it.each([
    [
      'LaunchAgent loaded',
      {
        loaded: true,
        plistExists: true,
        plistPath: '/tmp/agent.plist',
      },
    ],
    [
      'LaunchAgent not loaded (bootstrap path)',
      {
        loaded: false,
        plistExists: true,
        plistPath: '/tmp/agent.plist',
      },
    ],
    [
      'direct caddy start',
      {
        loaded: false,
        plistExists: false,
        plistPath: '/tmp/missing.plist',
      },
    ],
  ])(
    '[F-04] standby start (%s) never calls sudo of any kind',
    async (_label, autostart) => {
      /** @type {unknown[][]} */
      const calls = [];
      const exec = vi.fn(async (file, args = []) => {
        calls.push([file, ...(Array.isArray(args) ? args : [])]);
        return { stdout: '', stderr: '', code: 0 };
      });
      await start({
        exec,
        interactive: true,
        verbose: true,
        skipHandshake: true,
        runCertsCheck: async () => okCerts,
        findPort443Conflict: async () => null,
        getAutostartStatus: async () => autostart,
        uid: 501,
      });
      assertNoSudo(calls);
      expect(calls.some((c) => c[0] === 'sudo' && c[1] === '-v')).toBe(false);
      expect(calls.some((c) => c[0] === 'sudo' && c[1] === 'kill')).toBe(false);
    }
  );

  it('[F-04] declining the SIGTERM prompt yields zero sudo and zero kill calls', async () => {
    /** @type {unknown[][]} */
    const calls = [];
    const exec = vi.fn(async (file, args = []) => {
      calls.push([file, ...(Array.isArray(args) ? args : [])]);
      return { stdout: '', stderr: '', code: 0 };
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
    assertNoSudo(calls);
    expect(calls.every((c) => c[0] !== 'kill')).toBe(true);
  });

  it('[F-04] unprivileged kill success never escalates to sudo', async () => {
    /** @type {unknown[][]} */
    const calls = [];
    /** @type {Array<[number, string]>} */
    const kills = [];
    const exec = vi.fn(async (file, args = []) => {
      calls.push([file, ...(Array.isArray(args) ? args : [])]);
      return { stdout: '', stderr: '', code: 0 };
    });
    const result = await resolvePort443Conflict(
      { pid: '4242', name: 'OtherApp' },
      {
        exec,
        kill: (pid, sig) => {
          kills.push([pid, String(sig)]);
          return true;
        },
        confirm: async () => true,
        sleep: async () => {},
        recheck: async () => null,
      }
    );
    expect(result.ok).toBe(true);
    expect(kills).toEqual([[4242, 'SIGTERM']]);
    assertNoSudo(calls);
  });

  describe('[R5 F-01] signalProcess EPERM/ESRCH', () => {
    /** @param {string} code */
    function errWith(code) {
      const err = new Error(code);
      Object.assign(err, { code });
      return err;
    }

    it('[R5 F-01] ESRCH -> no sudo, ok', async () => {
      /** @type {unknown[][]} */
      const calls = [];
      const result = await resolvePort443Conflict(
        { pid: '99', name: 'OtherApp' },
        {
          exec: async (file, args = []) => {
            calls.push([file, ...(Array.isArray(args) ? args : [])]);
            return { stdout: '', stderr: '', code: 0 };
          },
          kill: () => {
            throw errWith('ESRCH');
          },
          confirm: async () => true,
          sleep: async () => {},
          recheck: async () => null,
        }
      );
      expect(result).toEqual({ ok: true, detail: 'SIGTERM' });
      assertNoSudo(calls);
    });

    it('[R5 F-01] EPERM -> sudo kill with right args, ok', async () => {
      /** @type {unknown[][]} */
      const calls = [];
      const result = await resolvePort443Conflict(
        { pid: '4242', name: 'OtherApp' },
        {
          exec: async (file, args = []) => {
            calls.push([file, ...(Array.isArray(args) ? args : [])]);
            return { stdout: '', stderr: '', code: 0 };
          },
          kill: () => {
            throw errWith('EPERM');
          },
          confirm: async () => true,
          sleep: async () => {},
          recheck: async () => null,
        }
      );
      expect(result.ok).toBe(true);
      expect(calls).toEqual([['sudo', 'kill', '-TERM', '4242']]);
      expect(calls.every((c) => !(c[0] === 'sudo' && c[1] === '-v'))).toBe(true);
    });

    it('[R5 F-01] EPERM + sudo kill fails -> start() returns 1, red message, no throw', async () => {
      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      const code = await start({
        verbose: true,
        interactive: true,
        skipHandshake: true,
        confirm: async () => true,
        sleep: async () => {},
        kill: () => {
          throw errWith('EPERM');
        },
        exec: async (file, args = []) => {
          if (file === 'sudo' && args[0] === 'kill') {
            throw new Error('sudo kill denied');
          }
          return { stdout: '', stderr: '', code: 0 };
        },
        runCertsCheck: async () => okCerts,
        findPort443Conflict: async () => ({ pid: '4242', name: 'OtherApp' }),
        getAutostartStatus: async () => ({ loaded: false, plistExists: false }),
      });
      expect(code).toBe(1);
      const joined = logSpy.mock.calls.map((c) => c.join(' ')).join('\n');
      expect(joined).toMatch(/sudo kill failed/i);
      logSpy.mockRestore();
    });

    it('[R5 F-01] other error -> ok:false, no sudo', async () => {
      /** @type {unknown[][]} */
      const calls = [];
      const result = await resolvePort443Conflict(
        { pid: '42', name: 'OtherApp' },
        {
          exec: async (file, args = []) => {
            calls.push([file, ...(Array.isArray(args) ? args : [])]);
            return { stdout: '', stderr: '', code: 0 };
          },
          kill: () => {
            throw errWith('EINVAL');
          },
          confirm: async () => true,
          sleep: async () => {},
          recheck: async () => null,
        }
      );
      expect(result.ok).toBe(false);
      expect(result.detail).toMatch(/Failed to signal PID 42/);
      assertNoSudo(calls);
    });

    it('[R5 F-01] KILL path: ESRCH ok without sudo; EPERM escalates; other error ok:false', async () => {
      /** @type {unknown[][]} */
      const calls = [];
      let phase = 0;
      const resultEsrch = await resolvePort443Conflict(
        { pid: '7', name: 'OtherApp' },
        {
          exec: async (file, args = []) => {
            calls.push([file, ...(Array.isArray(args) ? args : [])]);
            return { stdout: '', stderr: '', code: 0 };
          },
          kill: (_pid, sig) => {
            if (sig === 'SIGTERM') return true;
            throw errWith('ESRCH');
          },
          confirm: async () => true,
          sleep: async () => {},
          recheck: async () => {
            phase += 1;
            return phase === 1 ? { pid: '7', name: 'OtherApp' } : null;
          },
        }
      );
      expect(resultEsrch).toEqual({ ok: true, detail: 'SIGKILL' });
      assertNoSudo(calls);

      calls.length = 0;
      phase = 0;
      const resultEperm = await resolvePort443Conflict(
        { pid: '8', name: 'OtherApp' },
        {
          exec: async (file, args = []) => {
            calls.push([file, ...(Array.isArray(args) ? args : [])]);
            return { stdout: '', stderr: '', code: 0 };
          },
          kill: (_pid, sig) => {
            if (sig === 'SIGTERM') return true;
            throw errWith('EPERM');
          },
          confirm: async () => true,
          sleep: async () => {},
          recheck: async () => {
            phase += 1;
            return phase === 1 ? { pid: '8', name: 'OtherApp' } : null;
          },
        }
      );
      expect(resultEperm.ok).toBe(true);
      expect(calls).toEqual([['sudo', 'kill', '-KILL', '8']]);
      expect(calls.every((c) => !(c[0] === 'sudo' && c[1] === '-v'))).toBe(true);

      calls.length = 0;
      phase = 0;
      const resultOther = await resolvePort443Conflict(
        { pid: '9', name: 'OtherApp' },
        {
          exec: async (file, args = []) => {
            calls.push([file, ...(Array.isArray(args) ? args : [])]);
            return { stdout: '', stderr: '', code: 0 };
          },
          kill: (_pid, sig) => {
            if (sig === 'SIGTERM') return true;
            throw errWith('EINVAL');
          },
          confirm: async () => true,
          sleep: async () => {},
          recheck: async () => {
            phase += 1;
            return phase === 1 ? { pid: '9', name: 'OtherApp' } : null;
          },
        }
      );
      expect(resultOther.ok).toBe(false);
      expect(resultOther.detail).toMatch(/Failed to signal PID 9/);
      assertNoSudo(calls);
    });
  });

  it('[F-04] certs check never calls sudo', async () => {
    /** @type {unknown[][]} */
    const calls = [];
    const exec = vi.fn(async (file, args = []) => {
      calls.push([file, ...(Array.isArray(args) ? args : [])]);
      if (file === 'sudo') throw new Error('certs check must never call sudo');
      return { stdout: '', stderr: '', code: 0 };
    });
    await certsCheck({
      exec,
      skipHandshake: true,
      json: true,
      brewPrefix: '/opt/homebrew',
    });
    assertNoSudo(calls);
  });

  it('[F-04] doctor never calls sudo', async () => {
    /** @type {unknown[][]} */
    const calls = [];
    await runDoctor({
      skipHandshake: true,
      skipSite: true,
      projectChecks: false,
      projectCdnResult: { ok: true, offenders: [] },
      resolverPath: '/tmp/missing-resolver-sp',
      caddyfilePath: '/tmp/missing-Caddyfile',
      projectsPath: '/tmp/missing-projects.json',
      rootCaPath: '/tmp/missing-root.crt',
      plistPath: '/tmp/missing.plist',
      pathExists: async () => false,
      readFile: async () => {
        throw new Error('missing');
      },
      exec: async (file, args = []) => {
        calls.push([file, ...(Array.isArray(args) ? args : [])]);
        if (file === 'sudo') throw new Error('doctor must never call sudo');
        if (file === '/usr/bin/env' && args[0] === 'which') {
          return { stdout: `/usr/local/bin/${args[1]}\n`, stderr: '', code: 0 };
        }
        if (file === 'brew') return { stdout: '/usr/local\n', stderr: '', code: 0 };
        if (file === 'lsof') {
          return {
            stdout:
              'COMMAND PID USER FD TYPE DEVICE SIZE/OFF NODE NAME\ncaddy 9 me 8u IPv6 0x1 0t0 TCP *:443 (LISTEN)\n',
            stderr: '',
            code: 0,
          };
        }
        if (file === 'launchctl') {
          throw Object.assign(new Error('not loaded'), { code: 1 });
        }
        return { stdout: '', stderr: '', code: 0 };
      },
    });
    assertNoSudo(calls);
  });
});
