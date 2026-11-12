import { escapeRegExp } from './domain.js';
import { escapeCaddyQuotedString, validateRoot } from './paths.js';
import { buildOriginAllowlistRegex, validateOriginList } from './origins.js';
import { isValidDevPort, normalizeDevPort } from './dev-port.js';

/**
 * Marker written inside every Stagepass-managed site block.
 * v3: success responses set one ACAO (deferred replace) so PHP CORS is not duplicated.
 */
export const BLOCK_VERSION = 'v3';

/**
 * Sensitive path / extension blocking (always on).
 * Hidden segments: any path component starting with "." (.git, .env, .DS_Store, …).
 * Also: node_modules trees and private key / cert / db / log file extensions.
 */
export const BLOCKED_PATH_REGEXP =
  '(?i)((^|/)\\.|((^|/)node_modules(/|$))|\\.(pem|key|p12|pfx|crt|cer|sqlite|db|log)$)';

export const SENSITIVE_BLOCK_DOCS = Object.freeze({
  hiddenSegments: 'Any URL path segment starting with "." (e.g. /.git, /.env, /.npmrc)',
  directories: ['node_modules'],
  extensions: ['.pem', '.key', '.p12', '.pfx', '.crt', '.cer', '.sqlite', '.db', '.log'],
});

/**
 * @typedef {object} SiteBlockOptions
 * @property {boolean} [allowAllOrigins]
 * @property {string[]} [origins]
 * @property {boolean} [php] When false, omit php_fastcgi. Missing/undefined keeps PHP on (2.x backcompat).
 * @property {number|null|undefined} [devPort] Live-reload SSE reverse_proxy port (1024..65535), only while `stagepass dev` runs.
 */

/**
 * Whether a site block should enable PHP FastCGI.
 * Explicit false disables; everything else (including missing) keeps the legacy on behaviour.
 * @param {boolean|undefined} php
 * @returns {boolean}
 */
export function isPhpEnabled(php) {
  return php !== false;
}

/**
 * @param {string} domain - normalized foo.sp
 * @param {string} root - absolute project path
 * @param {SiteBlockOptions} [options]
 * @returns {string} full block including START/END markers
 */
export function renderSiteBlock(domain, root, options = {}) {
  const rootResult = validateRoot(root);
  if (!rootResult.ok) {
    throw new Error(rootResult.error);
  }

  const allowAllOrigins = options.allowAllOrigins === true;
  const originsResult = validateOriginList(options.origins || []);
  if (!originsResult.ok) {
    throw new Error(originsResult.error);
  }
  const origins = originsResult.origins;
  const php = isPhpEnabled(options.php);
  const devPort = normalizeDevPort(options.devPort);
  if (options.devPort != null && options.devPort !== '' && !devPort) {
    throw new Error(
      `Invalid devPort ${String(options.devPort)} (must be an integer 1024..65535).`
    );
  }

  const quotedRoot = `"${escapeCaddyQuotedString(rootResult.path)}"`;
  const optionsComment = formatOptionsComment({ allowAllOrigins, origins, php, devPort });

  const lines = [
    `# START: ${domain}`,
    `# stagepass-block: ${BLOCK_VERSION}`,
    optionsComment,
    `${domain} {`,
    // tls must stay at site level (not inside handle) — Caddy rejects it as an HTTP handler
    '    tls internal',
    '',
    `    @blocked path_regexp blocked ${BLOCKED_PATH_REGEXP}`,
    '    handle @blocked {',
    '        respond 404',
    '    }',
    '',
  ];

  if (allowAllOrigins) {
    lines.push(...allowAllCorsLines());
  } else {
    lines.push(...allowlistCorsLines(origins));
  }

  // Live-reload SSE must be before file_server so the path is not served from disk.
  if (devPort && isValidDevPort(devPort)) {
    lines.push(...liveReloadHandleLines(devPort, allowAllOrigins));
  }

  lines.push('', '    handle {', `        root * ${quotedRoot}`);
  if (php) {
    lines.push('        php_fastcgi 127.0.0.1:9000');
  }
  lines.push('        file_server');
  lines.push(...deferredSuccessCorsLines(allowAllOrigins));
  lines.push('    }', '}', `# END: ${domain}`);

  return lines.join('\n');
}

function formatOptionsComment({ allowAllOrigins, origins, php, devPort }) {
  const parts = [
    `allowAllOrigins=${allowAllOrigins ? 'true' : 'false'}`,
    `php=${php ? 'true' : 'false'}`,
  ];
  if (origins.length > 0) {
    parts.push(`origins=${origins.join(',')}`);
  }
  if (devPort && isValidDevPort(devPort)) {
    parts.push(`devPort=${devPort}`);
  }
  return `# stagepass-options: ${parts.join(' ')}`;
}

/**
 * reverse_proxy for /__stagepass/live with the same CORS / LNA policy as assets.
 * Port is validated before call; still interpolated only as a decimal integer.
 * @param {number} port
 * @param {boolean} allowAllOrigins
 */
function liveReloadHandleLines(port, allowAllOrigins) {
  const lines = [
    '    handle /__stagepass/live {',
    '        reverse_proxy 127.0.0.1:' + String(port) + ' {',
    '            flush_interval -1',
    '        }',
  ];
  lines.push(...deferredSuccessCorsLines(allowAllOrigins));
  lines.push('    }');
  return lines;
}

/**
 * One ACAO on HTTP 2xx, applied when the response is written.
 * `>` replaces an upstream value (PHP) instead of adding a second one.
 * Non-2xx responses are left alone so a PHP 403 does not gain ACAO.
 * @param {boolean} allowAllOrigins
 */
function deferredSuccessCorsLines(allowAllOrigins) {
  if (allowAllOrigins) {
    return [
      '        header {',
      '            >Access-Control-Allow-Origin *',
      '            match status 2xx',
      '        }',
    ];
  }
  return [
    '        header @cors_origin {',
    '            >Access-Control-Allow-Origin "{http.request.header.Origin}"',
    '            >Vary Origin',
    '            match status 2xx',
    '        }',
  ];
}

function allowAllCorsLines() {
  return [
    '    @options method OPTIONS',
    '    handle @options {',
    '        header Access-Control-Allow-Origin *',
    '        header Access-Control-Allow-Methods "GET, HEAD, POST, OPTIONS"',
    '        header Access-Control-Allow-Headers "{http.request.header.Access-Control-Request-Headers}"',
    '        header Access-Control-Max-Age 86400',
    '        header Access-Control-Allow-Private-Network true',
    '        respond 204',
    '    }',
  ];
}

function allowlistCorsLines(origins) {
  const originRe = buildOriginAllowlistRegex(origins);
  return [
    `    @cors_origin header_regexp Origin ${originRe}`,
    '    @cors_preflight {',
    '        method OPTIONS',
    `        header_regexp Origin ${originRe}`,
    '    }',
    '    handle @cors_preflight {',
    '        header Access-Control-Allow-Origin "{http.request.header.Origin}"',
    '        header Vary Origin',
    '        header Access-Control-Allow-Methods "GET, HEAD, POST, OPTIONS"',
    '        header Access-Control-Allow-Headers "{http.request.header.Access-Control-Request-Headers}"',
    '        header Access-Control-Max-Age 86400',
    '        header Access-Control-Allow-Private-Network true',
    '        respond 204',
    '    }',
    '    @options method OPTIONS',
    '    handle @options {',
    '        respond 204',
    '    }',
  ];
}

/**
 * @param {string} blockText
 * @returns {string|null} `v2`, `v3`, … or null when the block has no marker
 */
function blockMarkerVersion(blockText) {
  const m = blockText.match(/# stagepass-block:\s*(v\d+)/);
  return m ? m[1] : null;
}

/**
 * Parse Stagepass START/END blocks from a Caddyfile.
 * @param {string} content
 */
export function parseBlocks(content) {
  const re = /# START: ([^\n]+)\n([\s\S]*?)# END: \1/g;
  const blocks = [];
  let match;
  while ((match = re.exec(content)) !== null) {
    const domain = match[1].trim();
    const inner = match[2];
    const full = match[0];
    const isLegacy = !/# stagepass-block:\s*v\d+/m.test(full);
    const options = parseOptionsFromBlock(full);
    const root = extractRootFromBlock(inner);
    blocks.push({
      domain,
      full,
      inner,
      isLegacy,
      options,
      root,
      index: match.index,
      length: full.length,
    });
  }
  return blocks;
}

/**
 * @param {string} blockText
 */
export function parseOptionsFromBlock(blockText) {
  const defaults = { allowAllOrigins: false, origins: [], php: undefined, devPort: undefined };
  const line = blockText.match(/^# stagepass-options:\s*(.+)$/m);
  if (!line) {
    if (!/# stagepass-block:/m.test(blockText)) {
      // Legacy pre-marker blocks always had PHP.
      return { allowAllOrigins: true, origins: [], php: true, devPort: undefined };
    }
    return defaults;
  }

  const text = line[1];
  const allowMatch = text.match(/allowAllOrigins=(true|false)/);
  const allowAllOrigins = allowMatch ? allowMatch[1] === 'true' : false;
  const phpMatch = text.match(/(?:^|\s)php=(true|false)(?:\s|$)/);
  const php = phpMatch ? phpMatch[1] === 'true' : undefined;
  const originsMatch = text.match(/origins=([^\s]+)/);
  let origins = [];
  if (originsMatch) {
    const list = validateOriginList(originsMatch[1].split(',').filter(Boolean));
    origins = list.ok ? list.origins : [];
  }
  const devPortMatch = text.match(/(?:^|\s)devPort=(\d+)(?:\s|$)/);
  const devPort = devPortMatch ? normalizeDevPort(Number(devPortMatch[1])) : undefined;
  return { allowAllOrigins, origins, php, devPort: devPort || undefined };
}

/**
 * Extract root path from `root * "..."` inside a site block body.
 * @param {string} inner
 * @returns {string|null}
 */
export function extractRootFromBlock(inner) {
  const m = inner.match(/root\s+\*\s+"((?:\\.|[^"\\])*)"/);
  if (!m) return null;
  return m[1].replace(/\\"/g, '"').replace(/\\\\/g, '\\');
}

/**
 * Replace or append a site block for domain. Preserves foreign content.
 * @param {string} content
 * @param {string} domain
 * @param {string} newBlock
 */
export function upsertBlock(content, domain, newBlock) {
  const start = `# START: ${domain}`;
  const end = `# END: ${domain}`;
  const regex = new RegExp(
    `${escapeRegExp(start)}[\\s\\S]*?${escapeRegExp(end)}`,
    'g'
  );
  const trimmed = newBlock.trim();
  if (regex.test(content)) {
    return content.replace(regex, trimmed);
  }
  const base = content.trim();
  return base ? `${base}\n\n${trimmed}\n` : `${trimmed}\n`;
}

/**
 * Remove a site block for domain.
 * @param {string} content
 * @param {string} domain
 */
export function removeBlock(content, domain) {
  const start = `# START: ${domain}`;
  const end = `# END: ${domain}`;
  const regex = new RegExp(
    `${escapeRegExp(start)}[\\s\\S]*?${escapeRegExp(end)}`,
    'g'
  );
  if (!regex.test(content)) {
    return { content, removed: false };
  }
  let next = content.replace(regex, '').trim();
  next = next.replace(/\n{3,}/g, '\n\n');
  return { content: next, removed: true };
}

/**
 * Rewrite blocks that are not the current marker.
 *
 * No marker (pre-v2): allowAllOrigins=true so existing Webflow embedding keeps working.
 * An older marker (v2): same options comment, current header rules.
 *
 * @param {string} content
 * @param {object} [opts]
 * @param {(msg: string) => void} [opts.warn]
 */
export function migrateLegacyContent(content, opts = {}) {
  const warn = opts.warn || (() => {});
  const blocks = parseBlocks(content);
  const pending = blocks.filter((b) => blockMarkerVersion(b.full) !== BLOCK_VERSION);

  if (pending.length === 0) {
    return {
      content,
      changed: false,
      migrated: [],
      upgraded: [],
      skipped: [],
      warnings: [],
    };
  }

  let next = content;
  const migrated = [];
  const upgraded = [];
  const skipped = [];
  const warnings = [];

  const ordered = [...pending].sort((a, b) => b.index - a.index);

  for (const block of ordered) {
    const legacy = blockMarkerVersion(block.full) == null;
    const kind = legacy ? 'legacy block' : 'block';
    if (!block.root) {
      const reason = 'could not parse root path';
      skipped.push({ domain: block.domain, reason });
      const msg = `Left ${kind} ${block.domain} unchanged (${reason}).`;
      warnings.push(msg);
      warn(msg);
      continue;
    }

    const rootCheck = validateRoot(block.root);
    if (!rootCheck.ok) {
      const reason = rootCheck.error;
      skipped.push({ domain: block.domain, reason });
      const msg = `Left ${kind} ${block.domain} unchanged (${reason}).`;
      warnings.push(msg);
      warn(msg);
      continue;
    }

    let newBlock;
    try {
      // Legacy (no marker) keeps allow-all. A versioned block keeps its options comment.
      const renderOptions = legacy
        ? { allowAllOrigins: true, origins: [] }
        : {
            allowAllOrigins: block.options.allowAllOrigins === true,
            origins: block.options.origins || [],
            php: block.options.php,
            devPort: block.options.devPort,
          };
      newBlock = renderSiteBlock(block.domain, rootCheck.path, renderOptions);
    } catch (e) {
      const reason = e.message || String(e);
      skipped.push({ domain: block.domain, reason });
      const msg = `Left ${kind} ${block.domain} unchanged (${reason}).`;
      warnings.push(msg);
      warn(msg);
      continue;
    }

    next =
      next.slice(0, block.index) +
      newBlock.trim() +
      next.slice(block.index + block.length);
    const item = { domain: block.domain, root: rootCheck.path };
    if (legacy) migrated.push(item);
    else upgraded.push(item);
  }

  next = next.replace(/\n{3,}/g, '\n\n');
  if (next.trim()) {
    next = `${next.trim()}\n`;
  } else {
    next = '';
  }

  return {
    content: next,
    changed: migrated.length + upgraded.length > 0,
    migrated,
    upgraded,
    skipped,
    warnings,
  };
}

/**
 * Format a timestamp for Caddyfile.bak-YYYYMMDD-HHMMSS
 * @param {Date} [date]
 */
export function formatBackupStamp(date = new Date()) {
  const pad = (n) => String(n).padStart(2, '0');
  return (
    `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}` +
    `-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`
  );
}
