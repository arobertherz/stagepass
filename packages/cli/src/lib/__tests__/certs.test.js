import { describe, it, expect, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  assessCertificateValidity,
  certificateCoversHostname,
  loadCertificate,
  normalizeFingerprint,
  parseSecurityFindCertificateOutput,
  inspectKeychainTrust,
  checkLocalRootCa,
  assertNoDestructiveCertOps,
  DESTRUCTIVE_CERT_OPS,
  runCertsCheck,
  handshakeLocalDomain,
  isCaddyServing443,
  domainsNeedingSiteCertRenewal,
} from '../certs.js';

/** @param {import('node:crypto').X509Certificate} peer */
function mockTlsConnect(peer) {
  return (_opts, onSecure) => {
    const socket = {
      getPeerX509Certificate: () => peer,
      destroy() {},
      on() {},
    };
    process.nextTick(() => onSecure());
    return socket;
  };
}

const fixturesDir = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  'fixtures'
);

describe('certificate helpers', () => {
  it('normalizes fingerprints', () => {
    expect(normalizeFingerprint('ab:cd:ef')).toBe('ABCDEF');
    expect(normalizeFingerprint('ABCDEF')).toBe('ABCDEF');
  });

  it('assesses validity with injectable now (warn below 90 days)', () => {
    const pem = fs.readFileSync(path.join(fixturesDir, 'test-ca-short.crt'));
    const cert = loadCertificate(pem);
    const validTo = new Date(cert.validTo);
    const now = new Date(validTo.getTime() - 10 * 24 * 60 * 60 * 1000);
    const result = assessCertificateValidity(cert, { now, warnDays: 90 });
    expect(result.status).toBe('warn');
    expect(result.daysRemaining).toBeLessThan(90);
  });

  it('assesses long-lived cert as ok', () => {
    const pem = fs.readFileSync(path.join(fixturesDir, 'test-ca.crt'));
    const cert = loadCertificate(pem);
    const validFrom = new Date(cert.validFrom);
    const now = new Date(validFrom.getTime() + 24 * 60 * 60 * 1000);
    const result = assessCertificateValidity(cert, {
      now,
      warnDays: 90,
    });
    expect(result.status).toBe('ok');
  });

  it('detects expired cert via injectable now', () => {
    const pem = fs.readFileSync(path.join(fixturesDir, 'test-ca.crt'));
    const cert = loadCertificate(pem);
    const result = assessCertificateValidity(cert, {
      now: new Date('2099-01-01T00:00:00Z'),
    });
    expect(result.status).toBe('fail');
  });

  it('checks hostname coverage from SAN', () => {
    const pem = fs.readFileSync(path.join(fixturesDir, 'test-site.crt'));
    const cert = loadCertificate(pem);
    expect(certificateCoversHostname(cert, 'my-project.sp')).toBe(true);
    expect(certificateCoversHostname(cert, 'other.sp')).toBe(false);
  });

  it('parses security find-certificate fixtures and finds orphans', async () => {
    const output = fs.readFileSync(
      path.join(fixturesDir, 'security-find-certificate.txt'),
      'utf8'
    );
    const entries = parseSecurityFindCertificateOutput(output);
    expect(entries.length).toBe(2);

    const rootPem = fs.readFileSync(path.join(fixturesDir, 'test-ca.crt'));
    const root = loadCertificate(rootPem);
    const expected = normalizeFingerprint(root.fingerprint256);

    const trust = await inspectKeychainTrust({
      rootFingerprintSha256: expected,
      exec: async () => ({ stdout: output, stderr: '', code: 0 }),
    });
    expect(trust.trusted).toBe(true);
    expect(trust.orphans.length).toBe(1);
    expect(trust.orphans[0].sha1).toMatch(/^[0-9A-F]+$/);
  });

  it('checkLocalRootCa reads fixture path', async () => {
    const rootPath = path.join(fixturesDir, 'test-ca.crt');
    const cert = loadCertificate(fs.readFileSync(rootPath));
    const now = new Date(new Date(cert.validFrom).getTime() + 24 * 60 * 60 * 1000);
    const result = await checkLocalRootCa({
      rootPath,
      now,
    });
    expect(result.status).toBe('ok');
    expect(result.fingerprint256).toBeTruthy();
  });

  it('keeps permanent deletes disabled on the read-only path', () => {
    expect(DESTRUCTIVE_CERT_OPS.deleteRoot).toBe(false);
    expect(DESTRUCTIVE_CERT_OPS.deleteKeychainItem).toBe(false);
    expect(DESTRUCTIVE_CERT_OPS.deleteKeychainItemByCn).toBe(false);
    expect(DESTRUCTIVE_CERT_OPS.renewRoot).toBe(false);
    expect(assertNoDestructiveCertOps()).toBe(true);
  });

  it('runCertsCheck does not call any delete/remove APIs', async () => {
    const calls = [];
    const rootPath = path.join(fixturesDir, 'test-ca.crt');
    const securityOut = fs.readFileSync(
      path.join(fixturesDir, 'security-find-certificate.txt'),
      'utf8'
    );
    const rootCert = loadCertificate(fs.readFileSync(rootPath));
    const now = new Date(
      new Date(rootCert.validFrom).getTime() + 24 * 60 * 60 * 1000
    );
    await runCertsCheck({
      rootPath,
      skipHandshake: true,
      now,
      exec: async (file, args) => {
        calls.push({ file, args });
        if (file === 'security') {
          return { stdout: securityOut, stderr: '', code: 0 };
        }
        return { stdout: '', stderr: '', code: 0 };
      },
    });
    expect(calls.every((c) => c.file === 'security')).toBe(true);
    expect(
      calls.every(
        (c) =>
          !String(c.args || []).includes('delete-certificate') &&
          !String(c.args || []).includes('remove')
      )
    ).toBe(true);
  });

  it('excludes Homebrew secondary root fingerprint from orphans', async () => {
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
    const rootCert = loadCertificate(fs.readFileSync(rootPath));
    const secondaryCert = loadCertificate(fs.readFileSync(secondaryPem));
    const secondaryFp = normalizeFingerprint(secondaryCert.fingerprint256);
    const now = new Date(
      new Date(rootCert.validFrom).getTime() + 24 * 60 * 60 * 1000
    );

    const withoutSecondary = await runCertsCheck({
      rootPath,
      skipHandshake: true,
      now,
      exec: async () => ({ stdout: securityOut, stderr: '', code: 0 }),
    });
    expect(withoutSecondary.orphans.some((o) => o.sha256 === secondaryFp)).toBe(
      true
    );

    const withSecondary = await runCertsCheck({
      rootPath,
      brewPrefix,
      skipHandshake: true,
      now,
      pathExists: async (p) => p === rootPath || p === secondaryPath,
      readFile: async (p, enc) => {
        if (p === rootPath) return fs.readFileSync(rootPath, enc);
        if (p === secondaryPath) return fs.readFileSync(secondaryPem, enc);
        throw new Error(`unexpected read: ${p}`);
      },
      exec: async () => ({ stdout: securityOut, stderr: '', code: 0 }),
    });

    expect(withSecondary.secondaryRoots).toHaveLength(1);
    expect(withSecondary.secondaryRoots[0].fingerprint256).toBe(secondaryFp);
    expect(
      withSecondary.orphans.every((o) => o.sha256 !== secondaryFp)
    ).toBe(true);
    expect(withSecondary.orphans).toHaveLength(0);
    expect(withSecondary.trust.orphans).toHaveLength(0);
  });

  // Mutant `(list && []).filter` always yields [] for array inputs and would
  // drop unrelated orphans; `(list || [])` keeps non-matching entries.
  it('keeps orphans that are not the secondary brew root fingerprint', async () => {
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
    const rootCert = loadCertificate(fs.readFileSync(rootPath));
    const secondaryCert = loadCertificate(fs.readFileSync(secondaryPem));
    const rootFp = normalizeFingerprint(rootCert.fingerprint256);
    const secondaryFp = normalizeFingerprint(secondaryCert.fingerprint256);
    const otherFp = 'AA'.repeat(32);
    const now = new Date(
      new Date(rootCert.validFrom).getTime() + 24 * 60 * 60 * 1000
    );
    const report = await runCertsCheck({
      rootPath,
      brewPrefix,
      skipHandshake: true,
      now,
      pathExists: async (p) => p === rootPath || p === secondaryPath,
      readFile: async (p, enc) => {
        if (p === rootPath) return fs.readFileSync(rootPath, enc);
        if (p === secondaryPath) return fs.readFileSync(secondaryPem, enc);
        throw new Error(`unexpected read: ${p}`);
      },
      exec: async () => ({
        stdout: [
          `SHA-256 hash: ${rootFp}`,
          'SHA-1 hash: 1111111111111111111111111111111111111111',
          '',
          `SHA-256 hash: ${otherFp}`,
          'SHA-1 hash: 2222222222222222222222222222222222222222',
          '',
          `SHA-256 hash: ${secondaryFp}`,
          'SHA-1 hash: 3333333333333333333333333333333333333333',
        ].join('\n'),
        stderr: '',
        code: 0,
      }),
    });
    expect(report.secondaryRoots[0]?.fingerprint256).toBe(secondaryFp);
    expect(report.orphans.map((o) => o.sha256)).toContain(otherFp);
    expect(report.orphans.map((o) => o.sha256)).not.toContain(secondaryFp);
  });
});

describe('[M-1] TLS only when Caddy serves :443', () => {
  const rootPath = path.join(fixturesDir, 'test-ca.crt');
  const sitePem = fs.readFileSync(path.join(fixturesDir, 'test-site.crt'));
  const siteCert = loadCertificate(sitePem);
  const rootCert = loadCertificate(fs.readFileSync(rootPath));
  const midLife = new Date(
    new Date(rootCert.validFrom).getTime() + 24 * 60 * 60 * 1000
  );
  const securityOut = fs.readFileSync(
    path.join(fixturesDir, 'security-find-certificate.txt'),
    'utf8'
  );

  it('[M-1] isCaddyServing443 detects caddy vs foreign vs empty', async () => {
    expect(
      await isCaddyServing443({
        exec: async () => ({
          stdout: 'COMMAND PID\ncaddy 1\n',
          stderr: '',
          code: 0,
        }),
      })
    ).toBe(true);
    expect(
      await isCaddyServing443({
        exec: async () => ({
          stdout: 'COMMAND PID\nPython 9\n',
          stderr: '',
          code: 0,
        }),
      })
    ).toBe(false);
    expect(
      await isCaddyServing443({
        exec: async () => {
          const err = new Error('no listener');
          /** @type {any} */ (err).code = 1;
          throw err;
        },
      })
    ).toBe(false);
  });

  it('[M-1] skips handshakes when :443 is not caddy (no TLS fail / renew)', async () => {
    const connect = vi.fn(mockTlsConnect(siteCert));
    const report = await runCertsCheck({
      rootPath,
      now: midLife,
      domains: ['my-project.sp', 'other.sp'],
      caddyServing443: false,
      connect,
      exec: async () => ({ stdout: securityOut, stderr: '', code: 0 }),
    });
    expect(connect).not.toHaveBeenCalled();
    expect(report.handshakes).toEqual([
      {
        status: 'skip',
        servername: 'my-project.sp',
        reason: 'Caddy is not serving :443; TLS not checkable.',
      },
      {
        status: 'skip',
        servername: 'other.sp',
        reason: 'Caddy is not serving :443; TLS not checkable.',
      },
    ]);
    expect(domainsNeedingSiteCertRenewal(report.handshakes)).toEqual([]);
  });

  it('[M-1] reports fail + renew for bad leaf while Caddy serves :443', async () => {
    const expiredNow = new Date(
      new Date(siteCert.validTo).getTime() + 24 * 60 * 60 * 1000
    );
    const connect = vi.fn(mockTlsConnect(siteCert));
    const report = await runCertsCheck({
      rootPath,
      now: expiredNow,
      domains: ['my-project.sp'],
      caddyServing443: true,
      connect,
      exec: async () => ({ stdout: securityOut, stderr: '', code: 0 }),
    });
    expect(connect).toHaveBeenCalled();
    expect(report.handshakes[0]?.status).toBe('fail');
    expect(report.handshakes[0]?.reason).toMatch(/expired/i);
    expect(domainsNeedingSiteCertRenewal(report.handshakes)).toEqual([
      'my-project.sp',
    ]);
  });

  it('[M-1] SAN mismatch while Caddy serves :443 is fail for renew', async () => {
    const connect = vi.fn(mockTlsConnect(siteCert));
    const report = await runCertsCheck({
      rootPath,
      now: midLife,
      domains: ['wrong.sp'],
      caddyServing443: true,
      connect,
      exec: async () => ({ stdout: securityOut, stderr: '', code: 0 }),
    });
    expect(report.handshakes[0]?.status).toBe('fail');
    expect(report.handshakes[0]?.reason).toMatch(/SAN|CN/i);
    expect(domainsNeedingSiteCertRenewal(report.handshakes)).toEqual([
      'wrong.sp',
    ]);
  });
});
