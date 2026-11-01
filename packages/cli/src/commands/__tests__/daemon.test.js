import { describe, it, expect, vi } from 'vitest';
import { daemon, isPermanentDaemonFailure } from '../daemon.js';

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
      exec: async () => ({ stdout: '', stderr: '', code: 0 }),
      runForeground: async () => {
        throw new Error('caddy panicked unexpectedly');
      },
    });
    expect(code).toBe(1);
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
});
