import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../../lib/prompts.js', () => ({
  confirm: vi.fn(async () => false),
}));

import { resolvePort443Conflict, start } from '../start.js';
import { confirm as promptConfirm } from '../../lib/prompts.js';

const okReport = {
  root: { status: 'ok', reason: 'ok' },
  trust: { trusted: true },
  handshakes: [],
  orphans: [],
};

const trustReport = {
  root: { status: 'ok', reason: 'ok' },
  trust: { trusted: false },
  handshakes: [],
  orphans: [],
};

const trustAndSiteReport = {
  root: { status: 'ok', reason: 'ok' },
  trust: { trusted: false },
  handshakes: [{ status: 'fail', servername: 'a.sp', reason: 'bad' }],
  orphans: [],
};

const loadedAgent = {
  loaded: true,
  plistExists: true,
  plistPath: '/tmp/agent.plist',
};

function quietExec() {
  return async () => ({ stdout: '', stderr: '', code: 0 });
}

/**
 * @param {boolean} value
 * @param {() => Promise<void>} fn
 */
async function withStdinTTY(value, fn) {
  const previous = Object.getOwnPropertyDescriptor(process.stdin, 'isTTY');
  Object.defineProperty(process.stdin, 'isTTY', {
    configurable: true,
    enumerable: true,
    writable: true,
    value,
  });
  try {
    expect(process.stdin.isTTY).toBe(value);
    await fn();
  } finally {
    if (previous) Object.defineProperty(process.stdin, 'isTTY', previous);
    else delete process.stdin.isTTY;
  }
}

function visibleLogs(logSpy) {
  return logSpy.mock.calls
    .map((parts) => parts.map((part) => String(part)).join(' '))
    .join('\n')
    .replace(/\u001b\[[0-9;]*m/g, '');
}

describe('start.js surviving mutants', () => {
  /** @type {import('vitest').MockInstance} */
  let logSpy;

  beforeEach(() => {
    promptConfirm.mockClear();
    promptConfirm.mockImplementation(async () => false);
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('failure path returns exactly 1', async () => {
    const calls = [];
    await withStdinTTY(false, async () => {
      const code = await start({
        verbose: true,
        interactive: false,
        exec: async (file, args = []) => {
          calls.push([file, ...args]);
          if (file === 'caddy' && args[0] === 'start') {
            throw new Error('caddy boom');
          }
          return { stdout: '', stderr: '', code: 0 };
        },
        runCertsCheck: async () => okReport,
        findPort443Conflict: async () => null,
        getAutostartStatus: async () => ({
          loaded: false,
          plistExists: false,
        }),
      });
      expect(calls.some((c) => c[0] === 'caddy' && c[1] === 'start')).toBe(
        true
      );
      expect(visibleLogs(logSpy)).toMatch(/Failed to start/);
      expect(visibleLogs(logSpy)).toMatch(/caddy boom/);
      expect(code).toBe(1);
    });
  });

  it('uses a 400ms default sleep when opts.sleep is absent', async () => {
    vi.useFakeTimers();
    const kills = [];
    let state = 'pending';
    const pending = resolvePort443Conflict(
      { pid: '4242', name: 'otherd' },
      {
        exec: async () => ({ stdout: '', stderr: '', code: 0 }),
        kill: (pid, sig) => {
          kills.push([pid, String(sig)]);
          return true;
        },
        confirm: async () => true,
        recheck: async () => null,
      }
    ).then(
      (value) => {
        state = 'fulfilled';
        return value;
      },
      (error) => {
        state = 'rejected';
        throw error;
      }
    );
    pending.catch(() => {});

    // Confirm resolves on a microtask; the default sleep is still pending.
    await Promise.resolve();
    await Promise.resolve();
    expect(kills).toEqual([[4242, 'SIGTERM']]);
    expect(state).toBe('pending');

    await vi.advanceTimersByTimeAsync(399);
    expect(state).toBe('pending');

    await vi.advanceTimersByTimeAsync(1);
    await expect(pending).resolves.toEqual({ ok: true, detail: 'SIGTERM' });
    expect(state).toBe('fulfilled');
  });

  it('declining SIGKILL uses default false and does not signal KILL', async () => {
    const kills = [];
    const confirm = vi.fn(async (message) => !String(message).includes('SIGKILL'));
    const result = await resolvePort443Conflict(
      { pid: '55', name: 'otherd' },
      {
        exec: async () => ({ stdout: '', stderr: '', code: 0 }),
        kill: (pid, sig) => {
          kills.push([pid, String(sig)]);
          return true;
        },
        confirm,
        sleep: async () => {},
        recheck: async () => ({ pid: '55', name: 'otherd' }),
      }
    );
    expect(confirm).toHaveBeenNthCalledWith(
      2,
      'otherd (PID 55) is still listening. Send SIGKILL?',
      { default: false }
    );
    expect(kills).toEqual([[55, 'SIGTERM']]);
    expect(result).toEqual({
      ok: false,
      cancelled: true,
      detail: 'Still listening after SIGTERM; SIGKILL not confirmed.',
    });
  });

  it('interactive true without a confirm function uses prompts', async () => {
    const kills = [];
    await withStdinTTY(false, async () => {
      const code = await start({
        verbose: true,
        interactive: true,
        exec: quietExec(),
        kill: (pid, sig) => {
          kills.push([pid, String(sig)]);
          return true;
        },
        runCertsCheck: async () => okReport,
        findPort443Conflict: async () => ({ pid: '4242', name: 'otherd' }),
      });
      expect(promptConfirm).toHaveBeenCalledWith(
        'Send SIGTERM to otherd (PID 4242) to free port 443?',
        { default: false }
      );
      expect(visibleLogs(logSpy)).not.toMatch(
        /Refusing to signal without confirmation/
      );
      expect(kills).toEqual([]);
      expect(code).toBe(1);
    });
  });

  it('interactive false with a confirm function does not ask on cert findings', async () => {
    const confirm = vi.fn(async () => true);
    await withStdinTTY(true, async () => {
      const code = await start({
        verbose: true,
        interactive: false,
        confirm,
        exec: quietExec(),
        runCertsCheck: async () => trustReport,
        findPort443Conflict: async () => null,
        getAutostartStatus: async () => loadedAgent,
        uid: 501,
      });
      expect(confirm).not.toHaveBeenCalled();
      expect(promptConfirm).not.toHaveBeenCalled();
      expect(visibleLogs(logSpy)).toMatch(/Non-interactive start/);
      expect(code).toBe(0);
    });
  });

  it('non-interactive start without confirm refuses the port conflict and returns 1', async () => {
    const kills = [];
    await withStdinTTY(false, async () => {
      const code = await start({
        verbose: true,
        interactive: false,
        exec: quietExec(),
        kill: (pid, sig) => {
          kills.push([pid, String(sig)]);
          return true;
        },
        runCertsCheck: async () => okReport,
        findPort443Conflict: async () => ({ pid: '7', name: 'nginx' }),
      });
      expect(visibleLogs(logSpy)).toMatch(
        /Port 443 is blocked by nginx \(PID 7\)\. Refusing to signal without confirmation/
      );
      expect(promptConfirm).not.toHaveBeenCalled();
      expect(kills).toEqual([]);
      expect(code).toBe(1);
    });
  });

  it('interactive true with a confirm function asks, defaults false', async () => {
    const confirm = vi.fn(async () => false);
    await withStdinTTY(false, async () => {
      const code = await start({
        verbose: true,
        interactive: true,
        confirm,
        exec: quietExec(),
        runCertsCheck: async () => trustAndSiteReport,
        findPort443Conflict: async () => null,
        getAutostartStatus: async () => loadedAgent,
        uid: 501,
      });
      expect(confirm).toHaveBeenNthCalledWith(
        1,
        'Run `stagepass certs trust` now?',
        { default: false }
      );
      expect(confirm).toHaveBeenNthCalledWith(
        2,
        'Run `stagepass certs renew` for failing site certificates?',
        { default: false }
      );
      expect(code).toBe(0);
    });
  });

  it('calls the injected certsTrust with yes and exec when trust is confirmed', async () => {
    const exec = vi.fn(quietExec());
    const certsTrust = vi.fn(async () => 0);
    const confirm = vi.fn(async () => true);
    await withStdinTTY(false, async () => {
      const code = await start({
        verbose: true,
        interactive: true,
        confirm,
        certsTrust,
        exec,
        runCertsCheck: async () => trustReport,
        findPort443Conflict: async () => null,
        getAutostartStatus: async () => loadedAgent,
        uid: 501,
      });
      expect(certsTrust).toHaveBeenCalledTimes(1);
      expect(certsTrust).toHaveBeenCalledWith({ yes: true, exec });
      expect(code).toBe(0);
    });
  });

  it('PHP-FPM failure line shows detail, or failed when detail is empty', async () => {
    async function boot(message) {
      logSpy.mockClear();
      const code = await start({
        verbose: true,
        interactive: false,
        exec: async (file) => {
          if (file === 'brew') throw new Error(message);
          return { stdout: '', stderr: '', code: 0 };
        },
        runCertsCheck: async () => okReport,
        findPort443Conflict: async () => null,
        getAutostartStatus: async () => loadedAgent,
        uid: 501,
      });
      expect(code).toBe(0);
      const line = visibleLogs(logSpy)
        .split('\n')
        .find((entry) => entry.includes('PHP-FPM:'));
      return line;
    }

    await withStdinTTY(false, async () => {
      expect(await boot('brew services missing')).toBe(
        'PHP-FPM: brew services missing | brew services missing'
      );
      expect(await boot('')).toBe('PHP-FPM: failed');
    });
  });
});
