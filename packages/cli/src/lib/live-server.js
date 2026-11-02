/**
 * Local live-reload event server for `stagepass dev`.
 * Binds 127.0.0.1 only. Serves Server-Sent Events at /__stagepass/live.
 * No request data is reflected into responses.
 */

import http from 'node:http';
import path from 'node:path';
import fs from 'node:fs';
import { watch as fsWatch } from 'node:fs';

export const LIVE_PATH = '/__stagepass/live';
export const MAX_CONNECTIONS = 32;
export const HEARTBEAT_MS = 25_000;
export const DEFAULT_DEBOUNCE_MS = 100;

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
 * Turn an absolute file path under outAbs into a site-relative URL path
 * (project-root relative, with leading slash). Returns null when outside.
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
  // Skip transient editor/build junk
  const base = path.basename(file);
  if (base.startsWith('.') || base.endsWith('~') || base.endsWith('.map')) return null;
  const url = '/' + relProject.split(path.sep).join('/');
  return url;
}

/**
 * Format one SSE data event.
 * @param {{ type: string, paths: string[] }} payload
 */
export function formatSseEvent(payload) {
  return `data: ${JSON.stringify(payload)}\n\n`;
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
    const paths = [...pending].sort();
    pending.clear();
    const type = classifyChange(paths);
    broadcast({ type, paths });
  }

  function noteChange(fileAbs) {
    const urlPath = toUrlPath(fileAbs, projectRoot, outAbs);
    if (!urlPath) return;
    pending.add(urlPath);
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(flushPending, debounceMs);
  }

  function startWatch() {
    try {
      fs.mkdirSync(outAbs, { recursive: true });
    } catch {
      /* ignore */
    }
    try {
      watcher = fsWatch(outAbs, { recursive: true }, (_event, filename) => {
        if (!filename) return;
        const name = typeof filename === 'string' ? filename : String(filename);
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
    outAbs,
    outRel: outResolved.rel,
  };
}
