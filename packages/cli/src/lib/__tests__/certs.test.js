import { describe, it, expect } from 'vitest';
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
} from '../certs.js';

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

  it('never enables destructive cert ops', () => {
    expect(DESTRUCTIVE_CERT_OPS.deleteRoot).toBe(false);
    expect(DESTRUCTIVE_CERT_OPS.deleteKeychainItem).toBe(false);
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
});
