import fs from 'fs-extra';
import path from 'node:path';
import { X509Certificate } from 'node:crypto';
import tls from 'node:tls';
import {
  getCaddyRootCaPath,
  getCaddyCertificatesLocalDir,
  getCaddyPkiAuthoritiesLocalDir,
} from './paths.js';
import { defaultExec } from './exec.js';
import { validateDomain } from './domain.js';

/** Warn when the root CA expires within this many days. */
export const ROOT_EXPIRY_WARN_DAYS = 90;

export const CADDY_LOCAL_AUTHORITY_CN = 'Caddy Local Authority';

/**
 * Normalize a SHA-256 fingerprint to uppercase hex without separators.
 * @param {string} value
 */
export function normalizeFingerprint(value) {
  return String(value || '')
    .replace(/[^0-9a-fA-F]/g, '')
    .toUpperCase();
}

/**
 * @param {string|Buffer} pem
 * @returns {X509Certificate}
 */
export function loadCertificate(pem) {
  return new X509Certificate(pem);
}

/**
 * @param {X509Certificate} cert
 * @param {{ now?: Date, warnDays?: number }} [opts]
 */
export function assessCertificateValidity(cert, opts = {}) {
  const now = opts.now || new Date();
  const warnDays = opts.warnDays ?? ROOT_EXPIRY_WARN_DAYS;
  const validFrom = new Date(cert.validFrom);
  const validTo = new Date(cert.validTo);

  if (Number.isNaN(validFrom.getTime()) || Number.isNaN(validTo.getTime())) {
    return {
      status: 'fail',
      reason: 'Could not parse certificate validity dates.',
      validFrom,
      validTo,
      daysRemaining: null,
    };
  }

  if (now < validFrom) {
    return {
      status: 'fail',
      reason: 'Certificate is not valid yet.',
      validFrom,
      validTo,
      daysRemaining: null,
    };
  }

  if (now > validTo) {
    return {
      status: 'fail',
      reason: 'Certificate has expired.',
      validFrom,
      validTo,
      daysRemaining: 0,
    };
  }

  const msRemaining = validTo.getTime() - now.getTime();
  const daysRemaining = Math.floor(msRemaining / (24 * 60 * 60 * 1000));
  if (daysRemaining < warnDays) {
    return {
      status: 'warn',
      reason: `Certificate expires in ${daysRemaining} day(s) (below ${warnDays}-day threshold).`,
      validFrom,
      validTo,
      daysRemaining,
    };
  }

  return {
    status: 'ok',
    reason: `Valid until ${validTo.toISOString()} (${daysRemaining} day(s) remaining).`,
    validFrom,
    validTo,
    daysRemaining,
  };
}

/**
 * Check whether a peer certificate covers the expected hostname (SAN or CN).
 * @param {X509Certificate} cert
 * @param {string} hostname
 */
export function certificateCoversHostname(cert, hostname) {
  const host = String(hostname || '').toLowerCase();
  if (!host) return false;

  try {
    if (typeof cert.checkHost === 'function') {
      return Boolean(cert.checkHost(host));
    }
  } catch {
    // fall through to manual SAN/CN check
  }

  const san = cert.subjectAltName || '';
  const dnsNames = [...san.matchAll(/DNS:([^,\s]+)/gi)].map((m) =>
    m[1].toLowerCase()
  );
  if (dnsNames.includes(host)) return true;

  const cnMatch = /(?:^|\n)CN\s*=\s*([^\n]+)/i.exec(cert.subject || '');
  if (cnMatch && cnMatch[1].trim().toLowerCase() === host) return true;

  return false;
}

/**
 * Parse `security find-certificate -a -Z -c ...` output into certificate records.
 * @param {string} output
 * @returns {{ sha256: string, sha1: string, label: string }[]}
 */
export function parseSecurityFindCertificateOutput(output) {
  const blocks = String(output || '').split(/(?=SHA-256 hash:)/i);
  const results = [];

  for (const block of blocks) {
    const sha256Match = block.match(/SHA-256 hash:\s*([0-9A-Fa-f:]+)/i);
    if (!sha256Match) continue;
    const sha1Match = block.match(/SHA-1 hash:\s*([0-9A-Fa-f:]+)/i);
    const labelMatch = block.match(/"alis"<blob>="([^"]+)"/);
    results.push({
      sha256: normalizeFingerprint(sha256Match[1]),
      sha1: sha1Match ? normalizeFingerprint(sha1Match[1]) : '',
      label: labelMatch ? labelMatch[1] : '',
    });
  }

  return results;
}

/**
 * Compare local root against System keychain trust store (report only).
 * Never deletes keychain items.
 *
 * @param {object} opts
 * @param {string} opts.rootFingerprintSha256
 * @param {import('./exec.js').ExecFn} [opts.exec]
 * @param {string} [opts.keychainPath]
 * @param {string} [opts.searchName]
 */
export async function inspectKeychainTrust(opts) {
  const exec = opts.exec || defaultExec;
  const keychainPath =
    opts.keychainPath || '/Library/Keychains/System.keychain';
  const searchName = opts.searchName || CADDY_LOCAL_AUTHORITY_CN;
  const expected = normalizeFingerprint(opts.rootFingerprintSha256);

  let stdout = '';
  try {
    const result = await exec('security', [
      'find-certificate',
      '-a',
      '-Z',
      '-c',
      searchName,
      keychainPath,
    ]);
    stdout = result.stdout || '';
  } catch (error) {
    return {
      trusted: false,
      entries: [],
      orphans: [],
      error: error instanceof Error ? error.message : String(error),
    };
  }

  const entries = parseSecurityFindCertificateOutput(stdout);
  const match = entries.find((e) => e.sha256 === expected);
  const orphans = entries.filter((e) => e.sha256 && e.sha256 !== expected);

  return {
    trusted: Boolean(match),
    entries,
    orphans,
    error: null,
  };
}

/**
 * Read and assess the on-disk Caddy local root CA.
 * @param {object} [opts]
 * @param {string} [opts.rootPath]
 * @param {Date} [opts.now]
 * @param {(p: string) => Promise<boolean>} [opts.pathExists]
 * @param {(p: string, enc: string) => Promise<string>} [opts.readFile]
 */
export async function checkLocalRootCa(opts = {}) {
  const rootPath = opts.rootPath || getCaddyRootCaPath();
  const pathExists = opts.pathExists || ((p) => fs.pathExists(p));
  const readFile = opts.readFile || ((p, enc) => fs.readFile(p, enc));

  if (!(await pathExists(rootPath))) {
    return {
      status: 'fail',
      path: rootPath,
      reason: 'Caddy local root CA not found.',
      cert: null,
      validity: null,
      fingerprint256: null,
    };
  }

  let pem;
  try {
    pem = await readFile(rootPath, 'utf8');
  } catch (error) {
    return {
      status: 'fail',
      path: rootPath,
      reason: `Could not read root CA: ${error instanceof Error ? error.message : String(error)}`,
      cert: null,
      validity: null,
      fingerprint256: null,
    };
  }

  let cert;
  try {
    cert = loadCertificate(pem);
  } catch (error) {
    return {
      status: 'fail',
      path: rootPath,
      reason: `Invalid root CA PEM: ${error instanceof Error ? error.message : String(error)}`,
      cert: null,
      validity: null,
      fingerprint256: null,
    };
  }

  const validity = assessCertificateValidity(cert, { now: opts.now });
  return {
    status: validity.status,
    path: rootPath,
    reason: validity.reason,
    cert,
    validity,
    fingerprint256: normalizeFingerprint(cert.fingerprint256),
  };
}

/**
 * Optional TLS handshake against 127.0.0.1:443 with SNI.
 * rejectUnauthorized is false; validity dates and SAN are checked manually.
 *
 * @param {object} opts
 * @param {string} opts.servername
 * @param {string} [opts.host]
 * @param {number} [opts.port]
 * @param {number} [opts.timeoutMs]
 * @param {Date} [opts.now]
 * @param {typeof tls.connect} [opts.connect]
 */
export function handshakeLocalDomain(opts) {
  const host = opts.host || '127.0.0.1';
  const port = opts.port ?? 443;
  const timeoutMs = opts.timeoutMs ?? 2500;
  const servername = opts.servername;
  const connect = opts.connect || tls.connect;
  const now = opts.now || new Date();

  return new Promise((resolve) => {
    /** @type {import('node:tls').TLSSocket | null} */
    let socket = null;
    let settled = false;

    const finish = (result) => {
      if (settled) return;
      settled = true;
      try {
        if (socket) socket.destroy();
      } catch {
        // ignore
      }
      resolve(result);
    };

    try {
      socket = connect(
        {
          host,
          port,
          servername,
          rejectUnauthorized: false,
          timeout: timeoutMs,
        },
        () => {
          try {
            const peer = socket.getPeerX509Certificate
              ? socket.getPeerX509Certificate()
              : null;
            if (!peer) {
              finish({
                status: 'fail',
                servername,
                reason: 'No peer certificate returned.',
              });
              return;
            }
            const validity = assessCertificateValidity(peer, { now });
            if (validity.status === 'fail') {
              finish({
                status: 'fail',
                servername,
                reason: validity.reason,
                validity,
              });
              return;
            }
            if (!certificateCoversHostname(peer, servername)) {
              finish({
                status: 'fail',
                servername,
                reason: `Certificate SAN/CN does not cover ${servername}.`,
                validity,
              });
              return;
            }
            finish({
              status: validity.status === 'warn' ? 'warn' : 'ok',
              servername,
              reason:
                validity.status === 'warn'
                  ? validity.reason
                  : `TLS OK for ${servername}.`,
              validity,
            });
          } catch (error) {
            finish({
              status: 'fail',
              servername,
              reason: error instanceof Error ? error.message : String(error),
            });
          }
        }
      );
    } catch (error) {
      finish({
        status: 'fail',
        servername,
        reason: error instanceof Error ? error.message : String(error),
      });
      return;
    }

    socket.on('error', (error) => {
      finish({
        status: 'fail',
        servername,
        reason: error instanceof Error ? error.message : String(error),
      });
    });

    socket.on('timeout', () => {
      finish({
        status: 'fail',
        servername,
        reason: `TLS handshake timed out after ${timeoutMs}ms.`,
      });
    });
  });
}

/**
 * Full read-only certificate report for doctor / certs check.
 * @param {object} [opts]
 */
export async function runCertsCheck(opts = {}) {
  const root = await checkLocalRootCa({
    rootPath: opts.rootPath,
    now: opts.now,
    pathExists: opts.pathExists,
    readFile: opts.readFile,
  });

  /** @type {object} */
  const report = {
    root,
    trust: null,
    orphans: [],
    secondaryRoots: [],
    handshakes: [],
  };

  if (root.fingerprint256) {
    const trust = await inspectKeychainTrust({
      rootFingerprintSha256: root.fingerprint256,
      exec: opts.exec,
      keychainPath: opts.keychainPath,
      searchName: opts.searchName,
    });
    report.trust = trust;
    report.orphans = trust.orphans || [];
  } else {
    report.trust = {
      trusted: false,
      entries: [],
      orphans: [],
      error: 'No local root fingerprint to compare.',
    };
  }

  // Report-only: Homebrew service data dir may hold a second CA.
  // Exclude its fingerprint from orphans so --remove-orphans never deletes a still-valid brew root.
  if (opts.brewPrefix) {
    const secondary = path.join(
      opts.brewPrefix,
      'var',
      'lib',
      'caddy',
      'pki',
      'authorities',
      'local',
      'root.crt'
    );
    const pathExists = opts.pathExists || ((p) => fs.pathExists(p));
    const readFile = opts.readFile || ((p, enc) => fs.readFile(p, enc));
    if (await pathExists(secondary)) {
      let fingerprint256 = null;
      try {
        const pem = await readFile(secondary, 'utf8');
        const cert = loadCertificate(pem);
        fingerprint256 = normalizeFingerprint(cert.fingerprint256);
      } catch {
        // Still report the path; exclusion only when the fingerprint is readable.
      }
      report.secondaryRoots.push({
        path: secondary,
        fingerprint256,
        note: 'Additional Caddy root found (Homebrew service data dir). Report only; not deleted.',
      });
      if (fingerprint256) {
        const filterOrphans = (list) =>
          (list || []).filter((o) => o.sha256 !== fingerprint256);
        report.orphans = filterOrphans(report.orphans);
        if (report.trust) {
          report.trust.orphans = filterOrphans(report.trust.orphans);
        }
      }
    }
  }

  const domains = Array.isArray(opts.domains) ? opts.domains : [];
  if (opts.skipHandshake !== true && domains.length > 0) {
    for (const domain of domains) {
      const result = await handshakeLocalDomain({
        servername: domain,
        host: opts.handshakeHost,
        port: opts.handshakePort,
        timeoutMs: opts.handshakeTimeoutMs,
        now: opts.now,
        connect: opts.connect,
      });
      report.handshakes.push(result);
    }
  }

  return report;
}

/**
 * Destructive certificate capability flags.
 *
 * Permanent deletes of the on-disk root and CN-wildcard keychain deletes stay
 * disabled. Gated ops (`renewRootMoveBackup`, `renewSiteCertDir`,
 * `deleteKeychainItemBySha1`) are reachable only via `certs renew` after
 * explicit confirmation / non-interactive flags.
 */
export const DESTRUCTIVE_CERT_OPS = Object.freeze({
  deleteRoot: false,
  deleteKeychainItemByCn: false,
  /** @deprecated alias kept for older tests; same as deleteKeychainItemByCn */
  deleteKeychainItem: false,
  /** @deprecated root is moved, never deleted; use renewRootMoveBackup */
  renewRoot: false,
  renewRootMoveBackup: true,
  renewSiteCertDir: true,
  deleteKeychainItemBySha1: true,
});

/**
 * Assert permanent-delete ops stay disabled (read-only / check / trust paths).
 * @returns {true}
 */
export function assertReadOnlyCertOps() {
  if (
    DESTRUCTIVE_CERT_OPS.deleteRoot ||
    DESTRUCTIVE_CERT_OPS.deleteKeychainItemByCn ||
    DESTRUCTIVE_CERT_OPS.deleteKeychainItem ||
    DESTRUCTIVE_CERT_OPS.renewRoot
  ) {
    throw new Error(
      'Permanent root delete and CN-wildcard keychain delete must stay disabled.'
    );
  }
  return true;
}

/** @deprecated use assertReadOnlyCertOps */
export function assertNoDestructiveCertOps() {
  return assertReadOnlyCertOps();
}

/**
 * @param {'renewRootMoveBackup'|'renewSiteCertDir'|'deleteKeychainItemBySha1'} op
 */
export function assertDestructiveCertOpAllowed(op) {
  if (!DESTRUCTIVE_CERT_OPS[op]) {
    throw new Error(`Destructive certificate operation is disabled: ${op}`);
  }
  return true;
}

/**
 * Normalize a SHA-1 fingerprint to uppercase hex without separators.
 * Rejects non-hex / wrong length.
 * @param {string} value
 * @returns {{ ok: true, sha1: string } | { ok: false, error: string }}
 */
export function normalizeSha1Fingerprint(value) {
  const sha1 = normalizeFingerprint(value);
  if (!/^[0-9A-F]{40}$/.test(sha1)) {
    return {
      ok: false,
      error: 'SHA-1 fingerprint must be exactly 40 hex characters.',
    };
  }
  return { ok: true, sha1 };
}

/**
 * Build argv for `security delete-certificate -Z <sha1> <keychain>`.
 * Never accepts a CN / search name.
 *
 * @param {string} sha1
 * @param {string} [keychainPath]
 * @returns {{ ok: true, args: string[] } | { ok: false, error: string }}
 */
export function buildSecurityDeleteCertificateArgs(
  sha1,
  keychainPath = '/Library/Keychains/System.keychain'
) {
  const normalized = normalizeSha1Fingerprint(sha1);
  if (!normalized.ok) return normalized;
  if (typeof keychainPath !== 'string' || !keychainPath.trim()) {
    return { ok: false, error: 'Keychain path is required.' };
  }
  return {
    ok: true,
    args: ['delete-certificate', '-Z', normalized.sha1, keychainPath],
  };
}

/**
 * Resolve a safe on-disk directory for a linked `.sp` site certificate.
 * Guards against path traversal and refuses symlink paths.
 *
 * @param {object} opts
 * @param {string} opts.domain
 * @param {Iterable<string>|string[]} opts.linkedDomains
 * @param {string} [opts.certificatesLocalDir]
 * @param {(p: string) => Promise<import('node:fs').Stats>} [opts.lstat]
 * @param {(p: string) => Promise<boolean>} [opts.pathExists]
 * @returns {Promise<{ ok: true, dir: string } | { ok: false, error: string }>}
 */
export async function resolveSafeSiteCertDir(opts) {
  assertDestructiveCertOpAllowed('renewSiteCertDir');

  const validated = validateDomain(opts.domain);
  if (!validated.ok) {
    return { ok: false, error: validated.error };
  }
  const domain = validated.domain;
  const linked = new Set(
    [...(opts.linkedDomains || [])].map((d) => String(d).toLowerCase())
  );
  if (!linked.has(domain)) {
    return {
      ok: false,
      error: `Domain ${domain} is not a linked Stagepass project.`,
    };
  }

  const base = path.resolve(
    opts.certificatesLocalDir || getCaddyCertificatesLocalDir()
  );
  const candidate = path.resolve(base, domain);

  if (!candidate.startsWith(`${base}${path.sep}`)) {
    return { ok: false, error: 'Resolved certificate path escapes the local store.' };
  }
  if (candidate.includes('..')) {
    return { ok: false, error: 'Certificate path must not contain .. segments.' };
  }

  const pathExists = opts.pathExists || ((p) => fs.pathExists(p));
  if (!(await pathExists(candidate))) {
    return { ok: false, error: `Certificate directory does not exist: ${candidate}` };
  }

  const lstat = opts.lstat || ((p) => fs.lstat(p));
  let stats;
  try {
    stats = await lstat(candidate);
  } catch (error) {
    return {
      ok: false,
      error: `Could not lstat certificate directory: ${
        error instanceof Error ? error.message : String(error)
      }`,
    };
  }

  if (stats.isSymbolicLink()) {
    return { ok: false, error: 'Refusing to touch a symlinked certificate path.' };
  }
  if (!stats.isDirectory()) {
    return { ok: false, error: 'Certificate path is not a directory.' };
  }

  return { ok: true, dir: candidate };
}

/**
 * Delete scoped site certificate dirs for domains whose handshake/check failed,
 * then reload Caddy. Never touches the CA folder.
 *
 * @param {object} opts
 * @param {string[]} opts.domains domains that failed checks
 * @param {Iterable<string>|string[]} opts.linkedDomains
 * @param {import('./exec.js').ExecFn} [opts.exec]
 * @param {string} [opts.certificatesLocalDir]
 * @param {string} [opts.caddyfilePath]
 * @param {(p: string) => Promise<void>} [opts.remove]
 * @param {(p: string) => Promise<import('node:fs').Stats>} [opts.lstat]
 * @param {(p: string) => Promise<boolean>} [opts.pathExists]
 */
export async function renewSiteCertificates(opts) {
  assertDestructiveCertOpAllowed('renewSiteCertDir');
  const exec = opts.exec || defaultExec;
  const remove = opts.remove || ((p) => fs.remove(p));
  const domains = Array.isArray(opts.domains) ? opts.domains : [];
  /** @type {{ domain: string, dir: string }[]} */
  const deleted = [];
  /** @type {{ domain: string, error: string }[]} */
  const errors = [];

  for (const domain of domains) {
    const resolved = await resolveSafeSiteCertDir({
      domain,
      linkedDomains: opts.linkedDomains,
      certificatesLocalDir: opts.certificatesLocalDir,
      lstat: opts.lstat,
      pathExists: opts.pathExists,
    });
    if (!resolved.ok) {
      errors.push({ domain: String(domain), error: resolved.error });
      continue;
    }
    const normalized = validateDomain(domain);
    const domainLabel = normalized.ok ? normalized.domain : String(domain);
    try {
      await remove(resolved.dir);
      deleted.push({ domain: domainLabel, dir: resolved.dir });
    } catch (error) {
      errors.push({
        domain: domainLabel,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  let reloaded = false;
  let reloadError = null;
  if (deleted.length > 0) {
    try {
      const reloadArgs = ['reload'];
      if (opts.caddyfilePath) {
        reloadArgs.push('--config', opts.caddyfilePath);
      }
      await exec('caddy', reloadArgs);
      reloaded = true;
    } catch (error) {
      reloadError = error instanceof Error ? error.message : String(error);
    }
  }

  return { deleted, errors, reloaded, reloadError };
}

/**
 * Move the local CA authority folder to a timestamped backup (never delete).
 *
 * @param {object} [opts]
 * @param {string} [opts.authorityDir]
 * @param {Date} [opts.now]
 * @param {(src: string, dest: string) => Promise<void>} [opts.move]
 * @param {(p: string) => Promise<boolean>} [opts.pathExists]
 * @param {(p: string) => Promise<import('node:fs').Stats>} [opts.lstat]
 */
export async function moveLocalCaAuthorityToBackup(opts = {}) {
  assertDestructiveCertOpAllowed('renewRootMoveBackup');

  const authorityDir = path.resolve(
    opts.authorityDir || getCaddyPkiAuthoritiesLocalDir()
  );
  const pathExists = opts.pathExists || ((p) => fs.pathExists(p));
  if (!(await pathExists(authorityDir))) {
    return {
      ok: false,
      error: `CA authority directory not found: ${authorityDir}`,
    };
  }

  const lstat = opts.lstat || ((p) => fs.lstat(p));
  try {
    const stats = await lstat(authorityDir);
    if (stats.isSymbolicLink()) {
      return { ok: false, error: 'Refusing to move a symlinked CA authority path.' };
    }
    if (!stats.isDirectory()) {
      return { ok: false, error: 'CA authority path is not a directory.' };
    }
  } catch (error) {
    return {
      ok: false,
      error: `Could not lstat CA authority path: ${
        error instanceof Error ? error.message : String(error)
      }`,
    };
  }

  const now = opts.now || new Date();
  const stamp = now
    .toISOString()
    .replace(/[:.]/g, '-')
    .replace(/Z$/, 'Z');
  const backupDir = `${authorityDir}.backup.${stamp}`;
  if (await pathExists(backupDir)) {
    return { ok: false, error: `Backup path already exists: ${backupDir}` };
  }

  const move = opts.move || ((src, dest) => fs.move(src, dest));
  try {
    await move(authorityDir, backupDir);
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }

  return { ok: true, authorityDir, backupDir };
}

/**
 * Delete a single orphaned keychain certificate by SHA-1 fingerprint.
 *
 * @param {object} opts
 * @param {string} opts.sha1
 * @param {import('./exec.js').ExecFn} [opts.exec]
 * @param {string} [opts.keychainPath]
 */
export async function deleteKeychainCertificateBySha1(opts) {
  assertDestructiveCertOpAllowed('deleteKeychainItemBySha1');
  const built = buildSecurityDeleteCertificateArgs(
    opts.sha1,
    opts.keychainPath
  );
  if (!built.ok) return built;

  const exec = opts.exec || defaultExec;
  try {
    await exec('security', built.args);
    return { ok: true, args: built.args };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
      args: built.args,
    };
  }
}

/**
 * Domains whose TLS handshake failed in a way that site-cert renew can fix.
 * @param {{ status: string, servername: string, reason?: string }[]} handshakes
 * @returns {string[]}
 */
export function domainsNeedingSiteCertRenewal(handshakes = []) {
  return handshakes
    .filter((hs) => hs && hs.status === 'fail' && hs.servername)
    .map((hs) => hs.servername);
}
