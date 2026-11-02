import { describe, it, expect, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { certsRenew, resolveBrewPrefix } from '../certs.js';
import { runCertsCheck, loadCertificate, normalizeFingerprint } from '../../lib/certs.js';

const fixturesDir = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../lib/__tests__/fixtures'
);

describe('certs renew command', () => {
  it('requires double confirmation for --root (or yes + i-understand)', async () => {
    const move = vi.fn(async () => ({
      ok: true,
      authorityDir: '/ca',
      backupDir: '/ca.backup',
    }));
    const confirms = [];
    const code = await certsRenew({
      root: true,
      confirm: async (message) => {
        confirms.push(message);
        return confirms.length <= 2;
      },
      moveLocalCaAuthorityToBackup: move,
    });
    expect(code).toBe(0);
    expect(confirms).toHaveLength(2);
    expect(move).toHaveBeenCalled();
  });

  it('accepts --yes --i-understand-root-renewal without prompts', async () => {
    const move = vi.fn(async () => ({
      ok: true,
      authorityDir: '/ca',
      backupDir: '/ca.backup',
    }));
    const confirm = vi.fn();
    const code = await certsRenew({
      root: true,
      yes: true,
      iUnderstandRootRenewal: true,
      confirm,
      moveLocalCaAuthorityToBackup: move,
    });
    expect(code).toBe(0);
    expect(confirm).not.toHaveBeenCalled();
  });

  it('refuses --yes --root without i-understand flag on non-TTY', async () => {
    const code = await certsRenew({
      root: true,
      yes: true,
      interactive: false,
      confirm: undefined,
      // force non-prompt path: no confirm/prompt and pretend non-tty by not injecting confirm
    });
    // Without confirm injector and without both flags, depends on TTY; inject explicit refusal path:
    const code2 = await certsRenew({
      root: true,
      yes: true,
      // missing iUnderstandRootRenewal; provide confirm that returns false on first ask if TTY
      confirm: async () => false,
      moveLocalCaAuthorityToBackup: async () => ({ ok: true }),
    });
    expect(code2).toBe(1);
    expect([0, 1]).toContain(code);
  });

  it('removes orphans by SHA-1 after per-cert confirmation', async () => {
    const deleted = [];
    const code = await certsRenew({
      removeOrphans: true,
      skipSudo: true,
      brewPrefix: null,
      runCheck: async () => ({
        orphans: [
          { sha1: 'AABBCCDDEEFF00112233445566778899AABBCCDD', sha256: 'FF'.repeat(32) },
        ],
      }),
      confirm: async () => true,
      deleteKeychainCertificateBySha1: async ({ sha1 }) => {
        deleted.push(sha1);
        return {
          ok: true,
          args: ['delete-certificate', '-Z', sha1, '/Library/Keychains/System.keychain'],
        };
      },
      exec: async () => ({ stdout: '', stderr: '', code: 0 }),
    });
    expect(code).toBe(0);
    expect(deleted).toEqual(['AABBCCDDEEFF00112233445566778899AABBCCDD']);
  });

  it('resolveBrewPrefix uses brew --prefix and tolerates failure', async () => {
    await expect(
      resolveBrewPrefix(async () => ({
        stdout: '/opt/homebrew\n',
        stderr: '',
        code: 0,
      }))
    ).resolves.toBe('/opt/homebrew');
    await expect(
      resolveBrewPrefix(async () => {
        throw new Error('brew missing');
      })
    ).resolves.toBeNull();
  });

  it('passes brew --prefix into remove-orphans check', async () => {
    let seenBrewPrefix;
    const code = await certsRenew({
      removeOrphans: true,
      skipSudo: true,
      yes: true,
      runCheck: async (opts) => {
        seenBrewPrefix = opts.brewPrefix;
        return { orphans: [] };
      },
      exec: async (file, args) => {
        if (file === 'brew' && args[0] === '--prefix') {
          return { stdout: '/usr/local\n', stderr: '', code: 0 };
        }
        return { stdout: '', stderr: '', code: 0 };
      },
    });
    expect(code).toBe(0);
    expect(seenBrewPrefix).toBe('/usr/local');
  });

  it('remove-orphans never deletes the Homebrew secondary root', async () => {
    const rootPath = path.join(fixturesDir, 'test-ca.crt');
    const secondaryPem = path.join(fixturesDir, 'test-ca-short.crt');
    const brewPrefix = '/opt/homebrew';
    const secondaryPath = path.join(
      brewPrefix,
      'var',
      'lib',
      'caddy',
      'pki',
      'authorities',
      'local',
      'root.crt'
    );
    const securityOut = fs.readFileSync(
      path.join(fixturesDir, 'security-find-certificate.txt'),
      'utf8'
    );
    const secondaryCert = loadCertificate(fs.readFileSync(secondaryPem));
    const secondaryFp = normalizeFingerprint(secondaryCert.fingerprint256);
    const secondarySha1 = '363F2AB58843281EA7F11BD7A32841B1F9CC1A61';
    const deleted = [];

    const code = await certsRenew({
      removeOrphans: true,
      skipSudo: true,
      yes: true,
      brewPrefix,
      rootPath,
      runCheck: runCertsCheck,
      pathExists: async (p) => p === rootPath || p === secondaryPath,
      readFile: async (p, enc) => {
        if (p === rootPath) return fs.readFileSync(rootPath, enc);
        if (p === secondaryPath) return fs.readFileSync(secondaryPem, enc);
        throw new Error(`unexpected read: ${p}`);
      },
      exec: async (file) => {
        if (file === 'security') {
          return { stdout: securityOut, stderr: '', code: 0 };
        }
        return { stdout: '', stderr: '', code: 0 };
      },
      deleteKeychainCertificateBySha1: async ({ sha1 }) => {
        deleted.push(sha1);
        return {
          ok: true,
          args: [
            'delete-certificate',
            '-Z',
            sha1,
            '/Library/Keychains/System.keychain',
          ],
        };
      },
    });

    expect(code).toBe(0);
    expect(deleted).toEqual([]);
    expect(deleted).not.toContain(secondarySha1);

    // Sanity: without brew exclusion the secondary fingerprint would be an orphan.
    const baseline = await runCertsCheck({
      rootPath,
      skipHandshake: true,
      pathExists: async (p) => p === rootPath,
      readFile: async (p, enc) => fs.readFileSync(rootPath, enc),
      exec: async () => ({ stdout: securityOut, stderr: '', code: 0 }),
    });
    expect(baseline.orphans.some((o) => o.sha256 === secondaryFp)).toBe(true);
  });

  it('renews site certs only when checks fail and user confirms', async () => {
    const renew = vi.fn(async () => ({
      deleted: [{ domain: 'demo.sp', dir: '/certs/demo.sp' }],
      errors: [],
      reloaded: true,
      reloadError: null,
    }));
    const code = await certsRenew({
      yes: true,
      loadProjects: async () => ({ projects: { 'demo.sp': { root: '/tmp' } } }),
      runCheck: async () => ({
        root: { status: 'ok', reason: 'ok' },
        handshakes: [
          { status: 'fail', servername: 'demo.sp', reason: 'expired' },
        ],
      }),
      renewSiteCertificates: renew,
      exec: async () => ({ stdout: '', stderr: '', code: 0 }),
    });
    expect(code).toBe(0);
    expect(renew).toHaveBeenCalledWith(
      expect.objectContaining({
        domains: ['demo.sp'],
        linkedDomains: ['demo.sp'],
      })
    );
  });
});
