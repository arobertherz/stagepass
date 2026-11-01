import fs from 'fs-extra';
import path from 'node:path';
import { defaultExec, resolveCommand } from './exec.js';
import {
  getCaddyfilePath,
  getProjectsPath,
  getCaddyRootCaPath,
} from './paths.js';
import { parseBlocks } from './caddyfile.js';
import { loadProjects } from './projects.js';
import { runCertsCheck } from './certs.js';
import { getAutostartStatus } from './autostart.js';
import {
  CHROME_LNA_HINT,
  findUnpinnedCdnSnippets,
  RECOMMENDED_CDN_SNIPPETS,
} from './cdn-snippets.js';

/**
 * @typedef {'ok'|'warn'|'fail'|'info'} CheckStatus
 * @typedef {{ id: string, status: CheckStatus, message: string, detail?: string }} DoctorCheck
 */

/**
 * @param {string} id
 * @param {CheckStatus} status
 * @param {string} message
 * @param {string} [detail]
 * @returns {DoctorCheck}
 */
function check(id, status, message, detail) {
  return detail ? { id, status, message, detail } : { id, status, message };
}

/**
 * Parse `lsof -nP -iTCP:443 -sTCP:LISTEN` output.
 * @param {string} stdout
 * @returns {{ command: string, pid: string, name: string }[]}
 */
export function parseLsofListenOutput(stdout) {
  const lines = String(stdout || '')
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);
  const results = [];
  for (const line of lines) {
    if (line.startsWith('COMMAND')) continue;
    const parts = line.split(/\s+/);
    if (parts.length < 2) continue;
    results.push({
      command: parts[0],
      pid: parts[1],
      name: path.basename(parts[0]),
    });
  }
  return results;
}

/**
 * @param {string} content
 */
export function assessResolverContent(content) {
  const text = String(content || '');
  if (!/nameserver\s+127\.0\.0\.1\b/m.test(text)) {
    return {
      status: /** @type {CheckStatus} */ ('fail'),
      message: '/etc/resolver/sp exists but does not point to 127.0.0.1',
    };
  }
  return {
    status: /** @type {CheckStatus} */ ('ok'),
    message: '/etc/resolver/sp points to 127.0.0.1',
  };
}

/**
 * Structural checks for the Stagepass Caddyfile (not a full Caddy validate).
 * @param {string} content
 */
export function assessCaddyfileStructure(content) {
  const text = String(content || '').trim();
  if (!text) {
    return {
      status: /** @type {CheckStatus} */ ('warn'),
      message: 'Caddyfile is empty (no linked projects yet)',
    };
  }

  const blocks = parseBlocks(text);
  if (blocks.length === 0) {
    return {
      status: /** @type {CheckStatus} */ ('warn'),
      message: 'Caddyfile present but no Stagepass START/END site blocks found',
    };
  }

  const legacy = blocks.filter((b) => b.isLegacy);
  const missingRoot = blocks.filter((b) => !b.root);
  if (missingRoot.length > 0) {
    return {
      status: /** @type {CheckStatus} */ ('fail'),
      message: `Caddyfile has ${missingRoot.length} block(s) without a parseable root path`,
      detail: missingRoot.map((b) => b.domain).join(', '),
    };
  }

  if (legacy.length > 0) {
    return {
      status: /** @type {CheckStatus} */ ('warn'),
      message: `Caddyfile has ${legacy.length} legacy block(s); run stagepass start or reload to migrate`,
      detail: legacy.map((b) => b.domain).join(', '),
    };
  }

  return {
    status: /** @type {CheckStatus} */ ('ok'),
    message: `Caddyfile structure OK (${blocks.length} site block(s))`,
  };
}

/**
 * Run all doctor checks (read-only). Never uses sudo. Never changes anything.
 *
 * @param {object} [opts]
 * @returns {Promise<{ checks: DoctorCheck[], summary: { ok: number, warn: number, fail: number, info: number }, exitCode: number, hints: string[] }>}
 */
export async function runDoctor(opts = {}) {
  const exec = opts.exec || defaultExec;
  const pathExists = opts.pathExists || ((p) => fs.pathExists(p));
  const readFile = opts.readFile || ((p, enc) => fs.readFile(p, enc));
  const checks = /** @type {DoctorCheck[]} */ ([]);
  const hints = /** @type {string[]} */ ([]);

  // Homebrew
  const brewPath = await resolveCommand('brew', exec);
  if (!brewPath) {
    checks.push(check('homebrew', 'fail', 'Homebrew not found on PATH'));
  } else {
    checks.push(check('homebrew', 'ok', `Homebrew found (${brewPath})`));
  }

  let brewPrefix = null;
  if (brewPath) {
    try {
      const { stdout } = await exec('brew', ['--prefix']);
      brewPrefix = stdout.trim() || null;
    } catch {
      brewPrefix = null;
    }
  }

  // Caddy
  const caddyPath = await resolveCommand('caddy', exec);
  if (!caddyPath) {
    checks.push(check('caddy', 'fail', 'Caddy not found on PATH'));
  } else {
    checks.push(check('caddy', 'ok', `Caddy found (${caddyPath})`));
  }

  // PHP / php-fpm
  const phpPath = await resolveCommand('php', exec);
  let phpFpmPath = await resolveCommand('php-fpm', exec);
  if (!phpFpmPath && brewPrefix) {
    const candidate = path.join(brewPrefix, 'sbin', 'php-fpm');
    if (await pathExists(candidate)) phpFpmPath = candidate;
  }
  if (!phpPath && !phpFpmPath) {
    checks.push(check('php', 'fail', 'PHP / php-fpm not found'));
  } else if (!phpFpmPath) {
    checks.push(
      check(
        'php',
        'warn',
        `PHP found (${phpPath}) but php-fpm binary not found`,
        'Stagepass Caddy blocks use php_fastcgi 127.0.0.1:9000'
      )
    );
  } else {
    checks.push(
      check(
        'php',
        'ok',
        `PHP/php-fpm found (${phpFpmPath}${phpPath ? `; php=${phpPath}` : ''})`
      )
    );
  }

  // dnsmasq
  let dnsmasqPath = await resolveCommand('dnsmasq', exec);
  if (!dnsmasqPath && brewPrefix) {
    const candidate = path.join(brewPrefix, 'sbin', 'dnsmasq');
    if (await pathExists(candidate)) dnsmasqPath = candidate;
  }
  if (!dnsmasqPath) {
    checks.push(check('dnsmasq', 'fail', 'dnsmasq not found'));
  } else {
    checks.push(check('dnsmasq', 'ok', `dnsmasq found (${dnsmasqPath})`));
  }

  // /etc/resolver/sp
  const resolverPath = opts.resolverPath || '/etc/resolver/sp';
  if (!(await pathExists(resolverPath))) {
    checks.push(
      check(
        'resolver',
        'fail',
        `${resolverPath} missing`,
        'Run stagepass setup to create the .sp resolver'
      )
    );
  } else {
    try {
      const content = await readFile(resolverPath, 'utf8');
      const assessed = assessResolverContent(content);
      checks.push(check('resolver', assessed.status, assessed.message));
    } catch (error) {
      checks.push(
        check(
          'resolver',
          'fail',
          `Could not read ${resolverPath}`,
          error instanceof Error ? error.message : String(error)
        )
      );
    }
  }

  // Port 443 listener (no sudo)
  try {
    const { stdout } = await exec('lsof', [
      '-nP',
      '-iTCP:443',
      '-sTCP:LISTEN',
    ]);
    const listeners = parseLsofListenOutput(stdout);
    if (listeners.length === 0) {
      checks.push(
        check('port443', 'warn', 'Nothing listening on TCP 443', 'Run stagepass start')
      );
    } else {
      const summary = listeners
        .map((l) => `${l.command}(pid ${l.pid})`)
        .join(', ');
      const hasCaddy = listeners.some((l) =>
        /caddy/i.test(l.command) || /caddy/i.test(l.name)
      );
      checks.push(
        check(
          'port443',
          hasCaddy ? 'ok' : 'warn',
          hasCaddy
            ? `Port 443 listener: ${summary}`
            : `Port 443 occupied (no caddy seen): ${summary}`
        )
      );
    }
  } catch (error) {
    const err = /** @type {{ code?: string|number, message?: string }} */ (error);
    const msg = err.message || String(error);
    if (
      err.code === 'EPERM' ||
      err.code === 'EACCES' ||
      /permission denied/i.test(msg)
    ) {
      checks.push(
        check(
          'port443',
          'warn',
          'Could not inspect port 443 (permission denied)',
          'Doctor never uses sudo; try manually: lsof -nP -iTCP:443 -sTCP:LISTEN'
        )
      );
    } else if (err.code === 1 || err.code === '1') {
      // lsof exits 1 when no matches
      checks.push(
        check('port443', 'warn', 'Nothing listening on TCP 443', 'Run stagepass start')
      );
    } else {
      checks.push(check('port443', 'warn', `Could not inspect port 443: ${msg}`));
    }
  }

  // Caddyfile
  const caddyfilePath = opts.caddyfilePath || getCaddyfilePath();
  if (!(await pathExists(caddyfilePath))) {
    checks.push(
      check(
        'caddyfile',
        'fail',
        `Stagepass Caddyfile missing (${caddyfilePath})`,
        'Run stagepass setup / link'
      )
    );
  } else {
    try {
      const content = await readFile(caddyfilePath, 'utf8');
      const assessed = assessCaddyfileStructure(content);
      checks.push(
        check('caddyfile', assessed.status, assessed.message, assessed.detail)
      );
    } catch (error) {
      checks.push(
        check(
          'caddyfile',
          'fail',
          'Could not read Caddyfile',
          error instanceof Error ? error.message : String(error)
        )
      );
    }
  }

  // Linked projects whose folders no longer exist
  const projectsPath = opts.projectsPath || getProjectsPath();
  try {
    const doc = await loadProjects(projectsPath);
    const domains = Object.keys(doc.projects || {});
    const missing = [];
    for (const domain of domains) {
      const root = doc.projects[domain]?.root;
      if (!root || !(await pathExists(root))) {
        missing.push(`${domain} -> ${root || '(no root)'}`);
      }
    }
    if (domains.length === 0) {
      checks.push(check('projects', 'warn', 'No linked projects in projects.json'));
    } else if (missing.length > 0) {
      checks.push(
        check(
          'projects',
          'fail',
          `${missing.length} linked project folder(s) missing`,
          missing.join('; ')
        )
      );
    } else {
      checks.push(
        check('projects', 'ok', `${domains.length} linked project(s) exist on disk`)
      );
    }
  } catch (error) {
    checks.push(
      check(
        'projects',
        'warn',
        'Could not read projects.json',
        error instanceof Error ? error.message : String(error)
      )
    );
  }

  // Certificates (check only)
  const projectsDoc = await loadProjects(projectsPath);
  const linkedDomains = Object.keys(projectsDoc.projects || {});
  const certReport = await runCertsCheck({
    exec,
    rootPath: opts.rootCaPath || getCaddyRootCaPath(),
    brewPrefix,
    domains: opts.skipHandshake ? [] : linkedDomains,
    skipHandshake: opts.skipHandshake === true,
    now: opts.now,
    pathExists,
    readFile,
    connect: opts.connect,
    handshakeTimeoutMs: opts.handshakeTimeoutMs,
  });

  if (certReport.root.status === 'fail') {
    checks.push(
      check('certs.root', 'fail', certReport.root.reason, certReport.root.path)
    );
  } else if (certReport.root.status === 'warn') {
    checks.push(
      check('certs.root', 'warn', certReport.root.reason, certReport.root.path)
    );
  } else {
    checks.push(
      check('certs.root', 'ok', certReport.root.reason, certReport.root.path)
    );
  }

  if (!certReport.trust?.trusted) {
    checks.push(
      check(
        'certs.trust',
        'fail',
        'Caddy local root is not trusted in the System keychain',
        certReport.trust?.error || 'Run: stagepass certs trust'
      )
    );
  } else {
    checks.push(
      check('certs.trust', 'ok', 'Caddy local root is trusted in the System keychain')
    );
  }

  if (certReport.orphans?.length > 0) {
    const detail = certReport.orphans
      .map((o) => `SHA-1=${o.sha1 || 'unknown'} SHA-256=${o.sha256}`)
      .join('; ');
    checks.push(
      check(
        'certs.orphans',
        'warn',
        `${certReport.orphans.length} orphaned Caddy root(s) in keychain (report only; not deleted)`,
        detail
      )
    );
  } else {
    checks.push(check('certs.orphans', 'ok', 'No orphaned Caddy roots in keychain'));
  }

  for (const secondary of certReport.secondaryRoots || []) {
    checks.push(check('certs.secondary', 'warn', secondary.note, secondary.path));
  }

  for (const hs of certReport.handshakes || []) {
    checks.push(
      check(
        `certs.tls.${hs.servername}`,
        hs.status,
        hs.reason || `TLS check for ${hs.servername}`
      )
    );
  }

  // LaunchAgent
  const autostart = await getAutostartStatus({
    exec,
    pathExists,
    uid: opts.uid,
    plistPath: opts.plistPath,
  });
  if (!autostart.plistExists && !autostart.loaded) {
    checks.push(
      check(
        'autostart',
        'warn',
        'LaunchAgent not installed',
        'Optional: stagepass autostart on'
      )
    );
  } else if (autostart.plistExists && !autostart.loaded) {
    checks.push(
      check(
        'autostart',
        'warn',
        `LaunchAgent plist present but not loaded (${autostart.label})`,
        autostart.plistPath
      )
    );
  } else {
    checks.push(
      check(
        'autostart',
        'ok',
        `LaunchAgent loaded (${autostart.label})`,
        autostart.plistPath
      )
    );
  }

  // CDN snippets (Stagepass-recommended; do not scan user sites)
  const snippets = opts.cdnSnippets || RECOMMENDED_CDN_SNIPPETS;
  const unpinned = findUnpinnedCdnSnippets(snippets);
  if (!unpinned.ok) {
    checks.push(
      check(
        'cdn',
        'warn',
        'Recommended CDN snippets include @latest (prefer major pin @2)',
        unpinned.offenders.join(', ')
      )
    );
  } else {
    checks.push(
      check(
        'cdn',
        'ok',
        'Recommended CDN snippets use a pinned major (@2), not @latest'
      )
    );
  }

  hints.push(CHROME_LNA_HINT);

  const summary = { ok: 0, warn: 0, fail: 0, info: 0 };
  for (const c of checks) {
    if (c.status === 'ok') summary.ok += 1;
    else if (c.status === 'warn') summary.warn += 1;
    else if (c.status === 'fail') summary.fail += 1;
    else summary.info += 1;
  }

  return {
    checks,
    summary,
    exitCode: summary.fail > 0 ? 1 : 0,
    hints,
    certReport,
    autostart,
  };
}
