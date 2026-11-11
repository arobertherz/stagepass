import { describe, it, expect, vi } from 'vitest';
import { createRequire } from 'node:module';
import { daemon, isPermanentDaemonFailure } from '../daemon.js';

const CLI_VERSION = createRequire(import.meta.url)('../../../package.json').version;

describe('daemon', () => {
  it('classifies bind failures as permanent', () => {
    expect(isPermanentDaemonFailure('listen tcp :443: bind: address already in use')).toBe(
      true
    );
    expect(isPermanentDaemonFailure('EADDRINUSE')).toBe(true);
    expect(isPermanentDaemonFailure('permission denied')).toBe(true);
    expect(isPermanentDaemonFailure('unexpected crash')).toBe(false);
  });

  it('exits 0 when Caddyfile is missing (no KeepAlive loop)', async () => {
    const logs = [];
    const code = await daemon({
      caddyfilePath: '/tmp/missing-Caddyfile',
      logsDir: '/tmp/stagepass-logs-test',
      pathExists: async () => false,
      log: (msg) => logs.push(msg),
      notify: async () => {},
      ensurePhpFpm: async () => ({ ok: true, action: 'start' }),
      runForeground: async () => {
        throw new Error('should not start caddy');
      },
    });
    expect(code).toBe(0);
    expect(logs.some((l) => /Caddyfile missing/.test(l))).toBe(true);
  });

  it('skips TLS handshakes on cold start and exits 0 on bind failure', async () => {
    const logs = [];
    const certCalls = [];
    const code = await daemon({
      caddyfilePath: '/tmp/Caddyfile',
      projectsPath: '/tmp/projects.json',
      logsDir: '/tmp/stagepass-logs-test',
      pathExists: async (p) => p === '/tmp/Caddyfile',
      log: (msg) => logs.push(msg),
      notify: async () => {},
      ensurePhpFpm: async () => ({ ok: true, action: 'start' }),
      exec: async (file, args) => {
        certCalls.push({ file, args });
        if (file === 'security') {
          return { stdout: '', stderr: '', code: 0 };
        }
        return { stdout: '', stderr: '', code: 0 };
      },
      runForeground: async () => {
        throw Object.assign(new Error('listen tcp :443: bind: address already in use'), {
          stderr: 'EADDRINUSE',
        });
      },
    });

    // runCertsCheck may try to read root CA; absence is fine (logged, continues).
    expect(code).toBe(0);
    expect(logs.some((l) => /bind|EADDRINUSE|Port 443/i.test(l))).toBe(true);
    // No TLS connect attempts: handshake would require domains + skipHandshake false.
    // We assert daemon asked for skip via successful start path without hanging.
    expect(logs.some((l) => /certs tls /.test(l))).toBe(false);
    expect(certCalls.every((c) => Array.isArray(c.args))).toBe(true);
  });

  it('exits 1 on unexpected caddy failure so KeepAlive can retry', async () => {
    const code = await daemon({
      caddyfilePath: '/tmp/Caddyfile',
      projectsPath: '/tmp/projects.json',
      logsDir: '/tmp/stagepass-logs-test',
      pathExists: async (p) => p === '/tmp/Caddyfile',
      log: () => {},
      notify: async () => {},
      ensurePhpFpm: async () => ({ ok: true, action: 'start' }),
      exec: async () => ({ stdout: '', stderr: '', code: 0 }),
      runForeground: async () => {
        throw new Error('caddy panicked unexpectedly');
      },
    });
    expect(code).toBe(1);
  });

  it('[#74] writes the running daemon version and pid before caddy starts', async () => {
    const writes = [];
    const code = await daemon({
      caddyfilePath: '/tmp/Caddyfile',
      projectsPath: '/tmp/projects.json',
      logsDir: '/tmp/stagepass-logs-test',
      statePath: '/tmp/sp74-daemon.json',
      pathExists: async (p) => p === '/tmp/Caddyfile',
      log: () => {},
      notify: async () => {},
      ensurePhpFpm: async () => ({ ok: true, action: 'start' }),
      exec: async () => ({ stdout: '', stderr: '', code: 0 }),
      writeFile: async (p, c) => {
        writes.push({ p, c });
      },
      runForeground: async () => ({ stdout: '', stderr: '', code: 0 }),
    });
    expect(code).toBe(0);
    expect(writes).toHaveLength(1);
    expect(writes[0].p).toBe('/tmp/sp74-daemon.json');
    expect(JSON.parse(writes[0].c)).toEqual({ version: CLI_VERSION, pid: process.pid });
  });

  it('exits 0 when caddy exits cleanly', async () => {
    const runForeground = vi.fn(async () => ({ stdout: '', stderr: '', code: 0 }));
    const code = await daemon({
      caddyfilePath: '/tmp/Caddyfile',
      projectsPath: '/tmp/projects.json',
      logsDir: '/tmp/stagepass-logs-test',
      pathExists: async (p) => p === '/tmp/Caddyfile',
      log: () => {},
      exec: async () => ({ stdout: '', stderr: '', code: 0 }),
      ensurePhpFpm: async () => ({ ok: true, action: 'start' }),
      runForeground,
    });
    expect(code).toBe(0);
    expect(runForeground).toHaveBeenCalledWith('caddy', [
      'run',
      '--config',
      '/tmp/Caddyfile',
      '--adapter',
      'caddyfile',
    ]);
  });

  it('ensures PHP-FPM and notifies on failure without crashing', async () => {
    const notifications = [];
    const logs = [];
    const runForeground = vi.fn(async () => ({ stdout: '', stderr: '', code: 0 }));
    const code = await daemon({
      caddyfilePath: '/tmp/Caddyfile',
      projectsPath: '/tmp/projects.json',
      logsDir: '/tmp/stagepass-logs-test',
      pathExists: async (p) => p === '/tmp/Caddyfile',
      log: (msg) => logs.push(msg),
      exec: async () => ({ stdout: '', stderr: '', code: 0 }),
      ensurePhpFpm: async () => ({ ok: false, action: 'failed', detail: 'brew missing' }),
      notify: async ({ body }) => {
        notifications.push(body);
      },
      runForeground,
    });
    expect(code).toBe(0);
    expect(logs.some((l) => /php-fpm failed/i.test(l))).toBe(true);
    expect(notifications.some((n) => /PHP-FPM failed/i.test(n))).toBe(true);
  });

  it('notification failures never crash the daemon', async () => {
    const code = await daemon({
      caddyfilePath: '/tmp/Caddyfile',
      projectsPath: '/tmp/projects.json',
      logsDir: '/tmp/stagepass-logs-test',
      pathExists: async (p) => p === '/tmp/Caddyfile',
      log: () => {},
      exec: async () => ({ stdout: '', stderr: '', code: 0 }),
      ensurePhpFpm: async () => ({ ok: false, action: 'failed', detail: 'nope' }),
      notify: async () => {
        throw new Error('osascript exploded');
      },
      runForeground: async () => ({ stdout: '', stderr: '', code: 0 }),
    });
    expect(code).toBe(0);
  });
});
