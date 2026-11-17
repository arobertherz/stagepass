import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import os from 'node:os';
import path from 'node:path';
import fs from 'fs-extra';
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

  it('[M-1] skip handshakes never become TLS fail / renew findings', () => {
    const findings = summarizeCertFindings({
      root: { status: 'ok', reason: 'ok' },
      trust: { trusted: true },
      handshakes: [
        {
          status: 'skip',
          servername: 'a.sp',
          reason: 'Caddy is not serving :443; TLS not checkable.',
        },
      ],
      orphans: [],
    });
    expect(findings.some((f) => f.kind === 'site')).toBe(false);
    expect(findings.some((f) => /TLS fail/i.test(f.message))).toBe(false);
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

  // Mutant: `listener.name || basename(command)` -> `&&` would drop the basename fallback.
  it('findPort443Conflict falls back to basename when listener name is empty', async () => {
    const conflict = await findPort443Conflict({
      exec: async () => ({
        stdout: `COMMAND PID USER FD TYPE DEVICE SIZE/OFF NODE NAME
/opt/homebrew/bin/weirdd  4242 me  8u IPv6 0x1 0t0 TCP *:443 (LISTEN)
`,
        stderr: '',
        code: 0,
      }),
    });
    expect(conflict?.pid).toBe('4242');
    expect(conflict?.name).toMatch(/weirdd/);
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
        // Fixture PID must not reach process.kill: in a container PID namespace
        // that number can be a live vitest worker (F-3).
        kill: () => true,
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
    /** @type {Array<[number, string]>} */
    const kills = [];
    const confirms = [];
    const result = await resolvePort443Conflict(
      { pid: '55', name: 'otherd' },
      {
        exec: async (file, args) => {
          calls.push({ file, args });
          return { stdout: '', stderr: '', code: 0 };
        },
        kill: (pid, sig) => {
          kills.push([pid, String(sig)]);
          return true;
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
    expect(kills).toEqual([
      [55, 'SIGTERM'],
      [55, 'SIGKILL'],
    ]);
    expect(calls.every((c) => !(c.file === 'sudo' && c.args[0] === '-v'))).toBe(
      true
    );
  });

  it('SIGTERM-only path when process exits after first signal', async () => {
    const calls = [];
    /** @type {Array<[number, string]>} */
    const kills = [];
    const result = await resolvePort443Conflict(
      { pid: '77', name: 'otherd' },
      {
        exec: async (file, args) => {
          calls.push({ file, args });
          return { stdout: '', stderr: '', code: 0 };
        },
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
    expect(result.detail).toBe('SIGTERM');
    expect(kills).toEqual([[77, 'SIGTERM']]);
    expect(calls.every((c) => !(c.args || []).includes('-KILL'))).toBe(true);
    expect(calls.every((c) => !(c.file === 'sudo' && c.args[0] === '-v'))).toBe(
      true
    );
  });

  it('[AC-4] port 443 confirm defaults to false and No does not signal', async () => {
    const calls = [];
    const kills = [];
    const prompts = [];
    const result = await resolvePort443Conflict(
      { pid: '4242', name: 'OtherApp' },
      {
        exec: async (file, args) => {
          calls.push({ file, args });
          return { stdout: '', stderr: '' };
        },
        kill: (pid, sig) => {
          kills.push([pid, String(sig)]);
          return true;
        },
        confirm: async (message, options) => {
          prompts.push({ message, default: options?.default });
          return false;
        },
      }
    );
    expect(prompts).toEqual([
      {
        message: 'Send SIGTERM to OtherApp (PID 4242) to free port 443?',
        default: false,
      },
    ]);
    expect(result).toEqual({ ok: false, cancelled: true });
    expect(kills).toEqual([]);
    expect(calls).toEqual([]);
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
    // F-11: kickstart success path must return exactly 0 (not undefined).
    const code = await start({
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
    expect(code).toBe(0);
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
    expect(joined).toContain('Webflow Custom Code (Head):');
    expect(joined).toContain(
      'cdn.jsdelivr.net/npm/@stagepass/loader@2/dist/loader.min.js'
    );
    expect(joined).toContain('No modules are declared in stagepass.json.');
    expect(joined).not.toContain('@stagepass/modules');
    expect(joined).not.toContain('Webflow Custom Code (Footer):');
    expect(joined).not.toContain('cdn.stagepass.one');
  });

  it('prints head snippets after a direct caddy start', async () => {
    const code = await start({
      verbose: true,
      interactive: false,
      skipHandshake: true,
      exec: async () => ({ stdout: '', stderr: '', code: 0 }),
      runCertsCheck: async () => ({
        root: { status: 'ok', reason: 'ok' },
        trust: { trusted: true },
        handshakes: [],
        orphans: [],
      }),
      findPort443Conflict: async () => null,
      getAutostartStatus: async () => ({
        loaded: false,
        plistExists: false,
      }),
    });
    expect(code).toBe(0);
    const joined = logSpy.mock.calls.map((c) => c.join(' ')).join('\n');
    expect(joined).toMatch(/Stagepass is active/);
    expect(joined).toContain('Webflow Custom Code (Head):');
    expect(joined).toContain(
      'cdn.jsdelivr.net/npm/@stagepass/loader@2/dist/loader.min.js'
    );
    expect(joined).toContain('No modules are declared in stagepass.json.');
    expect(joined).not.toContain('@stagepass/modules');
    expect(joined).not.toContain('Webflow Custom Code (Footer):');
  });

  it('does not print head snippets when start fails', async () => {
    const code = await start({
      verbose: true,
      interactive: false,
      skipHandshake: true,
      exec: async (file, args) => {
        if (file === 'caddy' && args && args[0] === 'start') throw new Error('nope');
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
        loaded: false,
        plistExists: false,
      }),
    });
    expect(code).toBe(1);
    const joined = logSpy.mock.calls.map((c) => c.join(' ')).join('\n');
    expect(joined).not.toContain('Webflow Custom Code (Head):');
    expect(joined).not.toContain('loader.min.js');
  });

  async function projectWith(modules) {
    const cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'sp-start-'));
    const body = modules === undefined ? { name: 'demo' } : { name: 'demo', modules };
    await fs.writeJson(path.join(cwd, 'stagepass.json'), body);
    return cwd;
  }

  function startOk(cwd) {
    return start({
      cwd,
      verbose: true,
      interactive: false,
      skipHandshake: true,
      exec: async () => ({ stdout: '', stderr: '', code: 0 }),
      runCertsCheck: async () => ({
        root: { status: 'ok', reason: 'ok' },
        trust: { trusted: true },
        handshakes: [],
        orphans: [],
      }),
      findPort443Conflict: async () => null,
      getAutostartStatus: async () => ({ loaded: false, plistExists: false }),
    });
  }

  it('prints the loader and only the one declared module', async () => {
    const cwd = await projectWith(['cookies']);
    try {
      expect(await startOk(cwd)).toBe(0);
      const joined = logSpy.mock.calls.map((c) => c.join(' ')).join('\n');
      expect(joined).toContain('cdn.jsdelivr.net/npm/@stagepass/loader@2/dist/loader.min.js');
      expect(joined).toContain('cdn.jsdelivr.net/npm/@stagepass/modules@2/dist/cookies.min.js');
      expect(joined).not.toContain('inject.min.js');
      expect(joined).not.toContain('maintenance.min.js');
      expect(joined).not.toContain('No modules are declared');
      expect(joined).not.toContain('Webflow Custom Code (Footer):');
      expect(joined).not.toContain('cdn.stagepass.one');
    } finally {
      await fs.remove(cwd);
    }
  });

  it('prints several declared modules in inject, cookies, maintenance order', async () => {
    const cwd = await projectWith(['maintenance', 'cookies', 'inject']);
    try {
      expect(await startOk(cwd)).toBe(0);
      const joined = logSpy.mock.calls.map((c) => c.join(' ')).join('\n');
      const inject = joined.indexOf('inject.min.js');
      const cookies = joined.indexOf('cookies.min.js');
      const maintenance = joined.indexOf('maintenance.min.js');
      expect(inject).toBeGreaterThan(-1);
      expect(cookies).toBeGreaterThan(inject);
      expect(maintenance).toBeGreaterThan(cookies);
      expect(joined).not.toContain('all.min.js');
      expect(joined).not.toContain('Webflow Custom Code (Footer):');
    } finally {
      await fs.remove(cwd);
    }
  });

  it('prints the loader and a hint when no modules are declared', async () => {
    const missing = await projectWith(undefined);
    const empty = await projectWith([]);
    try {
      for (const cwd of [missing, empty]) {
        logSpy.mockClear();
        expect(await startOk(cwd)).toBe(0);
        const joined = logSpy.mock.calls.map((c) => c.join(' ')).join('\n');
        expect(joined).toContain('cdn.jsdelivr.net/npm/@stagepass/loader@2/dist/loader.min.js');
        expect(joined).toContain('No modules are declared in stagepass.json.');
        expect(joined).not.toContain('@stagepass/modules');
        expect(joined).not.toContain('Webflow Custom Code (Footer):');
      }
    } finally {
      await fs.remove(missing);
      await fs.remove(empty);
    }
  });

  it('prints no head block when start fails for a project that declares a module', async () => {
    const cwd = await projectWith(['cookies']);
    try {
      const code = await start({
        cwd,
        verbose: true,
        interactive: false,
        skipHandshake: true,
        exec: async (file, args) => {
          if (file === 'caddy' && args && args[0] === 'start') throw new Error('nope');
          return { stdout: '', stderr: '', code: 0 };
        },
        runCertsCheck: async () => ({
          root: { status: 'ok', reason: 'ok' },
          trust: { trusted: true },
          handshakes: [],
          orphans: [],
        }),
        findPort443Conflict: async () => null,
        getAutostartStatus: async () => ({ loaded: false, plistExists: false }),
      });
      expect(code).toBe(1);
      const joined = logSpy.mock.calls.map((c) => c.join(' ')).join('\n');
      expect(joined).not.toContain('Webflow Custom Code (Head):');
      expect(joined).not.toContain('cookies.min.js');
      expect(joined).not.toContain('No modules are declared');
    } finally {
      await fs.remove(cwd);
    }
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

  it('[N-2] skipped site handshakes: no "Certificates: ok", no renew offer', async () => {
    const confirmFn = vi.fn(async () => true);
    const code = await start({
      verbose: true,
      interactive: true,
      confirm: confirmFn,
      exec: async () => ({ stdout: '', stderr: '', code: 0 }),
      runCertsCheck: async () => ({
        root: { status: 'ok', reason: 'ok' },
        trust: { trusted: true },
        handshakes: [
          {
            status: 'skip',
            servername: 'a.sp',
            reason: 'Caddy is not serving :443; TLS not checkable.',
          },
        ],
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
    expect(code).toBe(0);
    expect(confirmFn).not.toHaveBeenCalled();
    const joined = logSpy.mock.calls.map((c) => c.join(' ')).join('\n');
    expect(joined).not.toMatch(/Certificates: ok/);
    expect(joined).toMatch(
      /Certificates: root ok, site TLS not checkable \(Caddy not serving :443\)\./
    );
  });

  it('[N-2] all handshakes ok: prints "Certificates: ok"', async () => {
    const code = await start({
      verbose: true,
      interactive: true,
      exec: async () => ({ stdout: '', stderr: '', code: 0 }),
      runCertsCheck: async () => ({
        root: { status: 'ok', reason: 'ok' },
        trust: { trusted: true },
        handshakes: [{ status: 'ok', servername: 'a.sp' }],
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
    expect(code).toBe(0);
    const joined = logSpy.mock.calls.map((c) => c.join(' ')).join('\n');
    expect(joined).toMatch(/Certificates: ok/);
  });

  it('[N-2] real site TLS failure still offers renew (Caddy serving)', async () => {
    const certsRenewFn = vi.fn(async () => {});
    const confirmFn = vi.fn(async () => true);
    const code = await start({
      verbose: true,
      interactive: true,
      confirm: confirmFn,
      certsRenew: certsRenewFn,
      exec: async () => ({ stdout: '', stderr: '', code: 0 }),
      runCertsCheck: async () => ({
        root: { status: 'ok', reason: 'ok' },
        trust: { trusted: true },
        handshakes: [{ status: 'fail', servername: 'a.sp', reason: 'bad' }],
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
    expect(code).toBe(0);
    expect(confirmFn).toHaveBeenCalled();
    expect(certsRenewFn).toHaveBeenCalled();
    const joined = logSpy.mock.calls.map((c) => c.join(' ')).join('\n');
    expect(joined).not.toMatch(/Certificates: ok/);
  });
});

describe('[F-4] certificate line is honest', () => {
  let logSpy;

  beforeEach(() => {
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  async function line(report) {
    logSpy.mockClear();
    await start({
      verbose: true,
      interactive: false,
      exec: async () => ({ stdout: '', stderr: '', code: 0 }),
      runCertsCheck: async () => ({
        trust: { trusted: true },
        orphans: [],
        handshakes: [],
        ...report,
      }),
      findPort443Conflict: async () => null,
      getAutostartStatus: async () => ({ loaded: false, plistExists: false }),
    });
    return logSpy.mock.calls.map((c) => c.join(' ')).join('\n');
  }

  it('[F-4] root warning and every handshake ok is not "Certificates: ok"', async () => {
    const joined = await line({
      root: { status: 'warn', reason: 'soon' },
      handshakes: [{ status: 'ok', servername: 'a.sp' }],
    });
    expect(joined).toMatch(/Certificates: root warning, site TLS ok\./);
    expect(joined).not.toMatch(/Certificates: ok/);
  });

  it('[F-4] root ok and a skip that is not the :443 check names no cause', async () => {
    const joined = await line({
      root: { status: 'ok' },
      handshakes: [{ status: 'skip', servername: 'a.sp', reason: 'skipped' }],
    });
    expect(joined).toMatch(/Certificates: root ok, site TLS not checkable\./);
    expect(joined).not.toMatch(/Caddy not serving/);
    expect(joined).not.toMatch(/Certificates: ok/);
  });

  it('[F-4] root warning and Caddy not serving :443 does not say root ok', async () => {
    const joined = await line({
      root: { status: 'warn' },
      handshakes: [
        {
          status: 'skip',
          servername: 'a.sp',
          reason: 'Caddy is not serving :443; TLS not checkable.',
        },
      ],
    });
    expect(joined).toMatch(
      /Certificates: root warning, site TLS not checkable \(Caddy not serving :443\)\./
    );
    expect(joined).not.toMatch(/root ok/);
  });

  it('[F-4] no handshakes (no linked sites or skipHandshake) is not checked', async () => {
    const ok = await line({ root: { status: 'ok' }, handshakes: [] });
    expect(ok).toMatch(/Certificates: root ok, site TLS not checked\./);
    expect(ok).not.toMatch(/Certificates: ok/);
    const warn = await line({ root: { status: 'warn' }, handshakes: [] });
    expect(warn).toMatch(/Certificates: root warning, site TLS not checked\./);
    const missing = await line({ root: {}, handshakes: [] });
    expect(missing).toMatch(/Certificates: root not checked, site TLS not checked\./);
  });

  it('[F-4] a handshake that is only a warning is not "Certificates: ok"', async () => {
    const joined = await line({
      root: { status: 'ok' },
      handshakes: [{ status: 'warn', servername: 'a.sp', reason: 'soon' }],
    });
    expect(joined).toMatch(/Certificates: root ok, site TLS not ok\./);
    expect(joined).not.toMatch(/Certificates: ok/);
  });
});
