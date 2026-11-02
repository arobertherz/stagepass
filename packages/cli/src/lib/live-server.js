/**
 * Local live-reload event server for `stagepass dev`.
 * Binds 127.0.0.1 only. Serves Server-Sent Events at /__stagepass/live.
 * No request data is reflected into responses.
 *
 * Change classification is content-based: identical rewrites (same bytes) are
 * ignored. Only real CSS changes batch as `{type:'css'}`; any other real change
 * is `{type:'reload'}`. `manifest.json`, dotfiles, `~` backups and `.map` files
 * are ignored.
 */

import http from 'node:http';
import path from 'node:path';
import fs from 'node:fs';
import { watch as fsWatch } from 'node:fs';
import { createHash } from 'node:crypto';

export const LIVE_PATH = '/__stagepass/live';
export const MAX_CONNECTIONS = 32;
export const HEARTBEAT_MS = 25_000;
export const DEFAULT_DEBOUNCE_MS = 100;
/** Skip hashing (treat as always-changed) above this size. */
export const MAX_HASH_BYTES = 4 * 1024 * 1024;
/** Bound memory for the content-hash map. */
export const MAX_TRACKED_FILES = 4096;

/**
 * @param {string} projectRoot absolute project root
 * @param {string} outDirRel relative output dir (e.g. "dist")
 * @returns {{ ok: true, abs: string, rel: string } | { ok: false, error: string }}
 */
export function resolveOutputDir(projectRoot, outDirRel = 'dist') {
  const root = path.resolve(projectRoot);
  const raw = typeof outDirRel === 'string' && outDirRel.trim() ? outDirRel.trim() : 'dist';
  if (path.isAbsolute(raw) || raw.includes('\0')) {
    return { ok: false, error: 'Output directory must be a relative path inside the project.' };
  }
  const normalized = path.normalize(raw).replace(/\\/g, '/');
  if (
    normalized === '..' ||
    normalized.startsWith('../') ||
    normalized.split('/').includes('..')
  ) {
    return { ok: false, error: 'Output directory must stay inside the project root.' };
  }
  const abs = path.resolve(root, normalized);
  const relToRoot = path.relative(root, abs);
  if (relToRoot.startsWith('..') || path.isAbsolute(relToRoot)) {
    return { ok: false, error: 'Output directory must stay inside the project root.' };
  }
  return { ok: true, abs, rel: relToRoot.split(path.sep).join('/') || '.' };
}

/**
 * Classify changed relative URL paths into css vs reload.
 * @param {string[]} urlPaths
 * @returns {'css'|'reload'}
 */
export function classifyChange(urlPaths) {
  if (urlPaths.length === 0) return 'reload';
  const onlyCss = urlPaths.every((p) => /\.css$/i.test(p.split('?')[0]));
  return onlyCss ? 'css' : 'reload';
}

/**
 * @param {string} base basename
 * @returns {boolean}
 */
export function isIgnoredWatchBase(base) {
  return (
    base.startsWith('.') ||
    base.endsWith('~') ||
    base.endsWith('.map') ||
    base === 'manifest.json'
  );
}

/**
 * Turn an absolute file path under outAbs into a site-relative URL path
 * (project-root relative, with leading slash). Returns null when outside or ignored.
 * @param {string} fileAbs
 * @param {string} projectRoot
 * @param {string} outAbs
 */
export function toUrlPath(fileAbs, projectRoot, outAbs) {
  const root = path.resolve(projectRoot);
  const out = path.resolve(outAbs);
  const file = path.resolve(fileAbs);
  const relOut = path.relative(out, file);
  if (relOut.startsWith('..') || path.isAbsolute(relOut)) return null;
  const relProject = path.relative(root, file);
  if (relProject.startsWith('..') || path.isAbsolute(relProject)) return null;
  const base = path.basename(file);
  if (isIgnoredWatchBase(base)) return null;
  return '/' + relProject.split(path.sep).join('/');
}

/**
 * Resolve a path that must stay under outAbs (no escape). Returns null if outside.
 * Does not follow the final path if missing (deletion); still rejects lexical escapes.
 * @param {string} fileAbs
 * @param {string} outAbs
 * @returns {string|null}
 */
export function resolveUnderOutDir(fileAbs, outAbs) {
  const out = path.resolve(outAbs);
  const file = path.resolve(fileAbs);
  const rel = path.relative(out, file);
  if (rel.startsWith('..') || path.isAbsolute(rel) || rel.includes('\0')) return null;
  return file;
}

/**
 * @param {string} fileAbs
 * @param {number} [maxBytes]
 * @returns {{ kind: 'missing' } | { kind: 'hash', hash: string } | { kind: 'large', token: string } | { kind: 'error' }}
 */
export function contentFingerprint(fileAbs, maxBytes = MAX_HASH_BYTES) {
  try {
    const st = fs.statSync(fileAbs);
    if (!st.isFile()) return { kind: 'error' };
    if (st.size > maxBytes) {
      return { kind: 'large', token: `large:${st.size}:${Math.trunc(st.mtimeMs)}` };
    }
    const buf = fs.readFileSync(fileAbs);
    return {
      kind: 'hash',
      hash: createHash('sha256').update(buf).digest('hex'),
    };
  } catch (err) {
    if (err && typeof err === 'object' && 'code' in err && err.code === 'ENOENT') {
      return { kind: 'missing' };
    }
    return { kind: 'error' };
  }
}

/**
 * Format one SSE data event.
 * @param {{ type: string, paths: string[] }} payload
 */
export function formatSseEvent(payload) {
  return `data: ${JSON.stringify(payload)}\n\n`;
}

/**
 * Walk files under dir (non-following for dirs outside via resolve). Soft-fail.
 * @param {string} dirAbs
 * @param {(fileAbs: string) => void} visit
 */
function walkFiles(dirAbs, visit) {
  /** @type {string[]} */
  const stack = [dirAbs];
  while (stack.length) {
    const dir = stack.pop();
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const ent of entries) {
      const full = path.join(dir, ent.name);
      if (ent.isDirectory()) {
        stack.push(full);
      } else if (ent.isFile()) {
        visit(full);
      }
    }
  }
}

/**
 * @typedef {object} LiveServerOptions
 * @property {string} projectRoot
 * @property {string} [outDir]
 * @property {number} [debounceMs]
 * @property {number} [maxConnections]
 * @property {number} [heartbeatMs]
 * @property {(msg: string) => void} [log]
 */

/**
 * Create the live-reload HTTP server (not yet listening).
 * @param {LiveServerOptions} options
 */
export function createLiveServer(options) {
  const projectRoot = path.resolve(options.projectRoot);
  const outResolved = resolveOutputDir(projectRoot, options.outDir || 'dist');
  if (!outResolved.ok) {
    throw new Error(outResolved.error);
  }
  const outAbs = outResolved.abs;
  const debounceMs =
    typeof options.debounceMs === 'number' && options.debounceMs >= 0
      ? options.debounceMs
      : DEFAULT_DEBOUNCE_MS;
  const maxConnections =
    typeof options.maxConnections === 'number' && options.maxConnections > 0
      ? options.maxConnections
      : MAX_CONNECTIONS;
  const heartbeatMs =
    typeof options.heartbeatMs === 'number' && options.heartbeatMs > 0
      ? options.heartbeatMs
      : HEARTBEAT_MS;
  const log = options.log || (() => {});

  /** @type {Set<import('node:http').ServerResponse>} */
  const clients = new Set();
  /** @type {Set<string>} */
  const pending = new Set();
  /** @type {ReturnType<typeof setTimeout>|null} */
  let debounceTimer = null;
  /** @type {import('node:fs').FSWatcher|null} */
  let watcher = null;
  /** @type {ReturnType<typeof setInterval>|null} */
  let heartbeat = null;
  /** @type {Map<string, string>} abs path → fingerprint token */
  const fileHashes = new Map();

  function rememberHash(fileAbs, token) {
    if (fileHashes.has(fileAbs)) {
      fileHashes.set(fileAbs, token);
      return;
    }
    if (fileHashes.size >= MAX_TRACKED_FILES) {
      const first = fileHashes.keys().next().value;
      if (first !== undefined) fileHashes.delete(first);
    }
    fileHashes.set(fileAbs, token);
  }

  function seedHashes() {
    fileHashes.clear();
    walkFiles(outAbs, (fileAbs) => {
      const safe = resolveUnderOutDir(fileAbs, outAbs);
      if (!safe) return;
      if (isIgnoredWatchBase(path.basename(safe))) return;
      const fp = contentFingerprint(safe);
      if (fp.kind === 'hash') rememberHash(safe, fp.hash);
      else if (fp.kind === 'large') rememberHash(safe, fp.token);
    });
  }

  /**
   * Compare current disk content to the last known fingerprint.
   * Updates the hash map when the file exists. Intended for flush time so
   * mid-write fs.watch races do not create false positives.
   * @param {string} fileAbs
   * @returns {boolean} true when content actually changed (or deleted)
   */
  function hasContentChanged(fileAbs) {
    const safe = resolveUnderOutDir(fileAbs, outAbs);
    if (!safe) return false;

    const fp = contentFingerprint(safe);
    if (fp.kind === 'missing') {
      if (!fileHashes.has(safe)) return false;
      fileHashes.delete(safe);
      return true;
    }
    if (fp.kind === 'error') {
      // Unreadable: treat as changed so we do not miss a real update.
      return true;
    }
    const token = fp.kind === 'hash' ? fp.hash : fp.token;
    const prev = fileHashes.get(safe);
    if (prev === token) return false;
    rememberHash(safe, token);
    return true;
  }

  function broadcast(payload) {
    const body = formatSseEvent(payload);
    for (const res of clients) {
      try {
        res.write(body);
      } catch {
        clients.delete(res);
        try {
          res.end();
        } catch {
          /* ignore */
        }
      }
    }
  }

  function flushPending() {
    debounceTimer = null;
    if (pending.size === 0) return;
    /** @type {string[]} */
    const changed = [];
    for (const fileAbs of pending) {
      if (!hasContentChanged(fileAbs)) continue;
      const urlPath = toUrlPath(fileAbs, projectRoot, outAbs);
      if (urlPath) changed.push(urlPath);
    }
    pending.clear();
    if (changed.length === 0) return;
    const paths = [...new Set(changed)].sort();
    const type = classifyChange(paths);
    broadcast({ type, paths });
  }

  function noteChange(fileAbs) {
    const safe = resolveUnderOutDir(fileAbs, outAbs);
    if (!safe) return;
    // Ignore junk / manifest early; defer content compare until debounce flush
    // so identical rewrites (and mid-write watch races) do not false-trigger.
    if (!toUrlPath(safe, projectRoot, outAbs)) return;
    pending.add(safe);
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(flushPending, debounceMs);
  }

  function startWatch() {
    try {
      fs.mkdirSync(outAbs, { recursive: true });
    } catch {
      /* ignore */
    }
    seedHashes();
    try {
      watcher = fsWatch(outAbs, { recursive: true }, (_event, filename) => {
        if (!filename) return;
        const name = typeof filename === 'string' ? filename : String(filename);
        // Join only; resolveUnderOutDir rejects escapes (including .. segments).
        noteChange(path.join(outAbs, name));
      });
      watcher.on('error', () => {
        /* keep server up; next change may recover */
      });
    } catch (err) {
      log(
        `Live reload: could not watch ${outAbs} (${err instanceof Error ? err.message : String(err)})`
      );
    }
  }

  function stopWatch() {
    if (debounceTimer) {
      clearTimeout(debounceTimer);
      debounceTimer = null;
    }
    pending.clear();
    fileHashes.clear();
    if (watcher) {
      try {
        watcher.close();
      } catch {
        /* ignore */
      }
      watcher = null;
    }
  }

  const server = http.createServer((req, res) => {
    const method = req.method || 'GET';
    let pathname = '/';
    try {
      pathname = new URL(req.url || '/', 'http://127.0.0.1').pathname;
    } catch {
      pathname = '/';
    }

    if (pathname !== LIVE_PATH) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Not found');
      return;
    }

    if (method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    if (method !== 'GET' && method !== 'HEAD') {
      res.writeHead(405, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Method not allowed');
      return;
    }

    if (clients.size >= maxConnections) {
      res.writeHead(503, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Too many connections');
      return;
    }

    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    if (method === 'HEAD') {
      res.end();
      return;
    }

    res.write(': connected\n\n');
    clients.add(res);

    const onClose = () => {
      clients.delete(res);
      req.off('close', onClose);
    };
    req.on('close', onClose);
  });

  function startHeartbeat() {
    heartbeat = setInterval(() => {
      for (const res of clients) {
        try {
          res.write(': ping\n\n');
        } catch {
          clients.delete(res);
        }
      }
    }, heartbeatMs);
    if (typeof heartbeat.unref === 'function') heartbeat.unref();
  }

  /**
   * @param {number} [port] 0 = ephemeral
   * @returns {Promise<{ port: number, close: () => Promise<void> }>}
   */
  function listen(port = 0) {
    return new Promise((resolve, reject) => {
      const onError = (err) => {
        server.off('listening', onListening);
        reject(err);
      };
      const onListening = () => {
        server.off('error', onError);
        const addr = server.address();
        const bound =
          addr && typeof addr === 'object' && typeof addr.port === 'number' ? addr.port : 0;
        startWatch();
        startHeartbeat();
        resolve({
          port: bound,
          close: async () => {
            if (heartbeat) {
              clearInterval(heartbeat);
              heartbeat = null;
            }
            stopWatch();
            for (const res of clients) {
              try {
                res.end();
              } catch {
                /* ignore */
              }
            }
            clients.clear();
            await new Promise((resClose, rejClose) => {
              server.close((err) => (err ? rejClose(err) : resClose()));
            });
          },
        });
      };
      server.once('error', onError);
      server.once('listening', onListening);
      server.listen(port, '127.0.0.1');
    });
  }

  return {
    server,
    listen,
    /** @internal test helpers */
    _clients: clients,
    _noteChange: noteChange,
    _flushPending: flushPending,
    _broadcast: broadcast,
    _fileHashes: fileHashes,
    _seedHashes: seedHashes,
    _hasContentChanged: hasContentChanged,
    outAbs,
    outRel: outResolved.rel,
  };
}
