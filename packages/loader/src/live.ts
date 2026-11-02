/**
 * Live-reload client (lazy chunk). Opens EventSource to the local .sp SSE endpoint.
 * Never evals stream data. Closes after the first error (no retry loop).
 */

export const LIVE_HOOK = 'stagepass.live.v1';
export const LIVE_PATH = '/__stagepass/live';

export type LiveStartOptions = {
  /** Absolute SSE URL (https://project.sp/__stagepass/live) */
  url: string;
  /** Local asset origin prefix (https://project.sp) */
  localBase: string;
  /** When true, one debug line on connect/error */
  debug?: boolean;
  log?: (...args: unknown[]) => void;
  /** Injectable EventSource for tests */
  EventSourceImpl?: typeof EventSource;
  /** Injectable location.reload */
  reload?: () => void;
  /** Injectable document */
  doc?: Document;
};

/**
 * Validate that url is https to the same host as localBase, path exactly LIVE_PATH.
 */
export function isSafeLiveUrl(url: string, localBase: string): boolean {
  try {
    const u = new URL(url);
    const b = new URL(localBase.endsWith('/') ? localBase : localBase + '/');
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return false;
    if (u.username || u.password) return false;
    if (u.hostname !== b.hostname) return false;
    if (u.pathname !== LIVE_PATH) return false;
    return true;
  } catch {
    return false;
  }
}

/**
 * Bust cache on local stylesheets whose href starts with localBase.
 * Inserts the new link before removing the old one (avoids flash).
 */
export function swapLocalStylesheets(localBase: string, doc: Document = document): number {
  const base = localBase.replace(/\/?$/, '/');
  const links = Array.from(
    doc.querySelectorAll<HTMLLinkElement>('link[rel="stylesheet"][href]')
  );
  let n = 0;
  const stamp = String(Date.now());
  for (const old of links) {
    const href = old.href || old.getAttribute('href') || '';
    if (!href.startsWith(base) && !href.startsWith(localBase)) continue;
    try {
      const u = new URL(href, doc.baseURI);
      u.searchParams.set('t', stamp);
      const next = old.cloneNode(false) as HTMLLinkElement;
      next.removeAttribute('integrity');
      next.href = u.href;
      if (old.parentNode) {
        old.parentNode.insertBefore(next, old);
        old.remove();
        n++;
      }
    } catch {
      /* ignore one bad link */
    }
  }
  return n;
}

type LiveEvent = { type?: string; paths?: unknown };

/**
 * Parse one SSE data payload. Returns null when invalid / unknown.
 */
export function parseLivePayload(raw: string): LiveEvent | null {
  try {
    const data = JSON.parse(raw) as LiveEvent;
    if (!data || typeof data !== 'object') return null;
    if (data.type !== 'css' && data.type !== 'reload') return null;
    return data;
  } catch {
    return null;
  }
}

/**
 * Start the live-reload EventSource. Returns a stop function.
 */
export function startLiveReload(opts: LiveStartOptions): () => void {
  const log = opts.log || (() => {});
  const doc = opts.doc || document;
  const reload = opts.reload || (() => location.reload());
  const ES = opts.EventSourceImpl || (typeof EventSource !== 'undefined' ? EventSource : null);
  if (!ES) return () => {};
  if (!isSafeLiveUrl(opts.url, opts.localBase)) return () => {};

  let es: EventSource | null = null;
  let closed = false;

  const stop = () => {
    if (closed) return;
    closed = true;
    if (es) {
      try {
        es.close();
      } catch {
        /* ignore */
      }
      es = null;
    }
  };

  try {
    es = new ES(opts.url);
  } catch {
    return () => {};
  }

  es.onmessage = (ev) => {
    if (closed) return;
    const payload = parseLivePayload(String(ev.data || ''));
    if (!payload) return;
    if (payload.type === 'css') {
      swapLocalStylesheets(opts.localBase, doc);
      return;
    }
    if (payload.type === 'reload') {
      stop();
      reload();
    }
  };

  es.onerror = () => {
    // First error closes permanently (dev not running or proxy gone). No retry loop.
    if (opts.debug) log('Live reload unavailable (closed).');
    stop();
  };

  if (opts.debug) log('Live reload listening.');
  return stop;
}
