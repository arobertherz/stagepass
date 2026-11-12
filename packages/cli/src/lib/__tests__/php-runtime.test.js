import { describe, it, expect } from 'vitest';
import fs from 'fs-extra';
import os from 'node:os';
import path from 'node:path';
import { runDoctor } from '../doctor.js';
import { runProjectSiteChecks } from '../doctor-site.js';
import {
  checkPhpRuntime,
  parsePhpVersion,
  phpProjectWarning,
  phpVersionOk,
  plainLine,
  warnPhpProject,
} from '../php-runtime.js';

function which(present) {
  return async (name) => (present.includes(name) ? `/usr/bin/${name}` : null);
}

describe('cli-php runtime check', () => {
  it('cli-php: parses versions and strips control characters', () => {
    expect(parsePhpVersion('PHP 8.2.28 (cli)\n')).toMatchObject({ major: 8, minor: 2, label: '8.2.28' });
    expect(parsePhpVersion('PHP 8.4.1 (cli)')).toMatchObject({ label: '8.4.1' });
    expect(phpVersionOk(parsePhpVersion('PHP 8.1.2 (cli)'))).toBe(false);
    expect(phpVersionOk(parsePhpVersion('PHP 8.2.0 (cli)'))).toBe(true);
    expect(plainLine('PHP 8.1\u0001evil\nline')).toBe('PHP 8.1 evil line');
    expect(plainLine('PHP 8.1\u0001evil\nline')).not.toMatch(/\u0001/);
  });

  it('cli-php: missing php fails with a macOS install hint', async () => {
    const result = await checkPhpRuntime({
      platform: 'darwin',
      resolveCommand: async () => null,
      exec: async () => {
        throw new Error('should not run');
      },
    });
    expect(result.ok).toBe(false);
    expect(result.status).toBe('fail');
    expect(result.message).toBe('PHP / php-fpm not found');
    expect(result.detail).toContain('brew install php');
    expect(result.detail).toContain('brew services start php');
    expect(phpProjectWarning(result, 'demo.sp')).toContain(
      'https://demo.sp/api/action.php needs PHP before it can answer.'
    );
  });

  it('cli-php: old php warns and does not echo control characters', async () => {
    const result = await checkPhpRuntime({
      platform: 'linux',
      resolveCommand: which(['php', 'php-fpm']),
      exec: async (_file, args = []) => ({
        stdout: args[0] === '-v' ? 'PHP 8.1.2 (cli)\u0001SECRET\n' : '',
        stderr: '',
      }),
    });
    expect(result.status).toBe('warn');
    expect(result.message).toBe('PHP 8.1.2 is older than 8.2');
    expect(result.detail).toMatch(/apt install php-fpm/);
    expect(JSON.stringify(result)).not.toMatch(/\u0001/);
    expect(JSON.stringify(result)).not.toContain('SECRET');
  });

  it('[F-1] PHP 8.3 with neither php-fpm nor php-cgi is not ok and warnPhpProject warns', async () => {
    const result = await checkPhpRuntime({
      platform: 'darwin',
      resolveCommand: which(['php']),
      exec: async () => ({ stdout: 'PHP 8.3.1 (cli)\n', stderr: '' }),
    });
    expect(result.ok).toBe(false);
    expect(result.status).toBe('warn');
    expect(result.message).toContain('neither php-fpm nor php-cgi');

    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'sp-php-f1-'));
    const warns = [];
    try {
      await fs.writeJson(path.join(dir, 'stagepass.json'), { php: true });
      const warned = await warnPhpProject(dir, {
        platform: 'linux',
        resolveCommand: which(['php']),
        exec: async () => ({ stdout: 'PHP 8.3.1 (cli)\n', stderr: '' }),
        warn: (msg) => warns.push(String(msg)),
        ensure: false,
      });
      expect(warned).toMatchObject({ applicable: true, ok: false });
      expect(warned.result.ok).toBe(false);
      expect(warned.result.status).toBe('warn');
      expect(warns.join('\n')).toContain('neither php-fpm nor php-cgi');
    } finally {
      await fs.remove(dir);
    }
  });

  it('cli-php: php-cgi satisfies fastcgi when php-fpm is absent', async () => {
    const result = await checkPhpRuntime({
      platform: 'linux',
      resolveCommand: which(['php', 'php-cgi']),
      exec: async () => ({ stdout: 'PHP 8.4.1 (cli)\n', stderr: '' }),
    });
    expect(result).toMatchObject({ ok: true, status: 'ok' });
    expect(result.message).toContain('php-cgi');
    expect(result.message).toContain('8.4.1');
  });

  it('cli-php: doctor php check uses the same version rule', async () => {
    const exec = async (file, args = []) => {
      if (file === '/usr/bin/env' && args[0] === 'which') {
        const name = args[1];
        if (['brew', 'caddy', 'php', 'php-fpm', 'dnsmasq'].includes(name)) {
          return { stdout: `/usr/bin/${name}\n`, stderr: '', code: 0 };
        }
        throw Object.assign(new Error('not found'), { code: 1 });
      }
      if (file === '/usr/bin/php' && args[0] === '-v') {
        return { stdout: 'PHP 8.1.2 (cli)\n', stderr: '', code: 0 };
      }
      if (file === 'brew' && args[0] === '--prefix') {
        return { stdout: '/usr/local\n', stderr: '', code: 0 };
      }
      return { stdout: '', stderr: '', code: 0 };
    };
    const result = await runDoctor({
      platform: 'darwin',
      exec,
      projectChecks: false,
      projectCdnScan: false,
      skipHandshake: true,
      resolverPath: '/tmp/sp-php-no-resolver',
      caddyfilePath: '/tmp/sp-php-no-caddy',
      projectsPath: '/tmp/sp-php-no-projects.json',
      rootCaPath: '/tmp/sp-php-no-ca.crt',
      plistPath: '/tmp/sp-php-no-agent.plist',
      pathExists: async () => false,
      readFile: async () => {
        throw new Error('missing');
      },
    });
    const php = result.checks.find((c) => c.id === 'php');
    expect(php).toMatchObject({ status: 'warn' });
    expect(php.message).toBe('PHP 8.1.2 is older than 8.2');
    expect(php.detail).toContain('brew install php');
  });

  it('cli-php: project doctor warns on an old interpreter and passes on 8.2', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'sp-php-doc-'));
    try {
      await fs.writeJson(path.join(dir, 'stagepass.json'), { modules: [], php: true });
      await fs.ensureDir(path.join(dir, 'api'));
      const old = await runProjectSiteChecks({
        cwd: dir,
        skipSite: true,
        platform: 'darwin',
        resolveCommand: which(['php', 'php-fpm']),
        exec: async () => ({ stdout: 'PHP 7.4.33 (cli)\n', stderr: '' }),
      });
      expect(old.find((c) => c.id === 'project.php')).toMatchObject({
        status: 'warn',
        message: expect.stringContaining('7.4.33'),
      });
      const ok = await runProjectSiteChecks({
        cwd: dir,
        skipSite: true,
        platform: 'linux',
        resolveCommand: which(['php', 'php-fpm']),
        exec: async () => ({ stdout: 'PHP 8.2.28 (cli)\n', stderr: '' }),
      });
      expect(ok.find((c) => c.id === 'project.php')).toMatchObject({
        status: 'ok',
        message: expect.stringContaining('8.2.28'),
      });
    } finally {
      await fs.remove(dir);
    }
  });
});
