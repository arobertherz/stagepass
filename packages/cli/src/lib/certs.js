import fs from 'fs-extra';
import path from 'node:path';
import { X509Certificate } from 'node:crypto';
import tls from 'node:tls';
import { getCaddyRootCaPath } from './paths.js';
import { defaultExec } from './exec.js';

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
    if (await pathExists(secondary)) {
      report.secondaryRoots.push({
        path: secondary,
        note: 'Additional Caddy root found (Homebrew service data dir). Report only; not deleted.',
      });
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
 * Guard: this module never deletes files or keychain items.
 * Exported for unit tests.
 */
export const DESTRUCTIVE_CERT_OPS = Object.freeze({
  deleteRoot: false,
  deleteKeychainItem: false,
  renewRoot: false,
});

export function assertNoDestructiveCertOps() {
  if (
    DESTRUCTIVE_CERT_OPS.deleteRoot ||
    DESTRUCTIVE_CERT_OPS.deleteKeychainItem ||
    DESTRUCTIVE_CERT_OPS.renewRoot
  ) {
    throw new Error('Destructive certificate operations must stay disabled.');
  }
  return true;
}
