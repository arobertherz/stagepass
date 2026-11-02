import { cleanDomain, isValidDomain } from './domain.js';
import {
  SESSION_KEY,
  createSession,
  parseSession,
  parseSessionHours,
  serializeSession,
} from './session.js';
import { appendQueryParam, buildLocalAssetUrl } from './url.js';
import { lnaHintMessage, queryLoopbackPermission } from './lna.js';
import { applyScriptLoadOrder } from './script-attrs.js';
import { detectRuntimeEnv, parseStagingHosts } from './env.js';
import { isGlobalFree, isValidJsIdentifier } from './alias.js';
import { canCapability, getClientInfo, getThemeInfo } from './client.js';
import { createModuleRegistry } from './registry.js';
import type { CreateFlag, FlagState } from './flag.js';

declare const __STAGEPASS_VERSION__: string;

(function () {
  const K = SESSION_KEY;
  const P = 'stagepass';
  const W = window as any;
  const d = document;
  const loc = location;
  const PKG_VERSION =
    typeof __STAGEPASS_VERSION__ !== 'undefined' ? __STAGEPASS_VERSION__ : '0.0.0';
  const LOADER_RE = /loader(?:\.min)?\.js/i;

  function getLoaderScript(): HTMLScriptElement | null {
    try {
      if (d.currentScript instanceof HTMLScriptElement) return d.currentScript;
    } catch (_) {}
    try {
      const scripts = d.querySelectorAll<HTMLScriptElement>('script[src*="loader"]');
      for (let i = scripts.length - 1; i >= 0; i--) {
        if (LOADER_RE.test(scripts[i].src || '')) return scripts[i];
      }
    } catch (_) {}
    return null;
  }

  const loaderScript = getLoaderScript();
  const attr = (name: string) =>
    loaderScript ? loaderScript.getAttribute('data-stagepass-' + name) : null;
  const muteConsole = attr('mute-console') === 'true';
  const sessionHours = parseSessionHours(attr('session-hours'));
  const loaderVersionAttr = attr('version');
  const stagingHosts = parseStagingHosts(attr('staging-hosts'));
  const aliasName = attr('alias');

  const p = new URLSearchParams(loc.search);

  /** [file, line] of the first caller outside the loader */
  function getCallerLocation(): string[] | null {
    try {
      const stack = (new Error().stack || '').split('\n');
      for (let i = 3; i < stack.length; i++) {
        const m = stack[i].match(/([^/]+\.(?:js|ts))(?:[?#][^:]*)?:(\d+)/);
        if (m && !LOADER_RE.test(m[1])) return [m[1], m[2]];
      }
    } catch (_) {}
    return null;
  }

  let hasActiveSession = false;
  // Dev flag state (rendered by the lazy flag chunk once it has loaded).
  // Messages are plain text, capped to the latest 50 and truncated; the flag never parses HTML.
  const flagState = { n: [0, 0], m: [], swapped: 0 } as unknown as FlagState;
  let renderFlag: (() => void) | null = null;
  const time = () => new Date().toTimeString().slice(0, 8);
  const fileOf = (u: string) => (u || '').split(/[?#]/)[0].split('/').pop() || '';
  const str = (a: unknown): string => {
    if (typeof a === 'string') return a;
    if (a instanceof Error) return a.message || a.name;
    try {
      const j = JSON.stringify(a);
      if (j !== undefined) return j;
    } catch (_) {}
    return String(a);
  };
  const note = (i: number, text: string, src = '', line: string | number = '') => {
    flagState.n[i]++;
    const m = flagState.m;
    m.push({ type: i ? 'error' : 'warn', time: time(), src, line, text: text.length > 500 ? text.slice(0, 500) + '…' : text });
    if (m.length > 50) m.shift();
    if (renderFlag) renderFlag();
  };

  function log(level: string, ...args: unknown[]) {
    if (!hasActiveSession) return;
    const where = getCallerLocation();
    if (level === 'warn' || level === 'error')
      note(level === 'warn' ? 0 : 1, args.map(str).join(' '), where ? where[0] : '', where ? where[1] : '');
    try {
      const pre = `[🎫 ${time()}${where ? ' | ' + where.join(':') : ''}]`;
      const c = console as any;
      if (level === 'error') c.log(`%c${pre}`, 'color:red;font-weight:bold', ...args);
      else if (c[level]) c[level](pre, ...args);
      else c.log(pre, level, ...args);
    } catch (_) {}
  }

  function spLog(...args: unknown[]) {
    const level = args[0] === 'warn' || args[0] === 'error' ? (args.shift() as string) : 'log';
    log(level, ...args);
  }
  const spWarn = (...args: unknown[]) => log('warn', ...args);
  const spError = (...args: unknown[]) => log('error', ...args);
  // Logs once even when no session is active (connect/disconnect/invalid domain)
  const logOnce = (level: string, msg: string) => {
    const prev = hasActiveSession;
    hasActiveSession = true;
    log(level, msg);
    hasActiveSession = prev;
  };

  function readSessionDomain(): string | null {
    try {
      const raw = localStorage.getItem(K);
      const record = parseSession(raw);
      if (!record && raw) localStorage.removeItem(K);
      return record ? record.domain : null;
    } catch (_) {
      return null;
    }
  }

  function clearSession(): void {
    try {
      localStorage.removeItem(K);
    } catch (_) {}
  }

  let paramProcessed = false;
  let sv = readSessionDomain();

  if (p.has(P)) {
    const v = p.get(P);
    if (v === 'off' || v === '0' || v === 'false') {
      clearSession();
      sv = null;
      logOnce('log', '🔌 Stagepass disconnected.');
    } else if (v) {
      const c = v === 'debug' ? 'debug' : cleanDomain(v);
      if (c && isValidDomain(c)) {
        try {
          localStorage.setItem(K, serializeSession(createSession(c, sessionHours)));
        } catch (_) {}
        sv = c;
        paramProcessed = true;
        logOnce(
          'log',
          c === 'debug' ? '🔍 Stagepass debug mode enabled.' : `🔌 Stagepass connected to: ${c}`
        );
      } else if (c) {
        logOnce('warn', `Invalid domain: ${c}. Only .sp domains are allowed.`);
      }
    }
    try {
      p.delete(P);
      const s = p.toString();
      history.replaceState({}, '', loc.pathname + (s ? `?${s}` : '') + loc.hash);
    } catch (_) {}
  }

  if (sv && !isValidDomain(sv)) {
    clearSession();
    sv = null;
  }

  const debug = sv === 'debug';
  hasActiveSession = !!sv;
  if (sv && !paramProcessed && !debug) log('log', `🔌 Stagepass connected to: ${sv}`);

  const dev = !!sv;
  const swap = dev && !debug;
  const dom = swap ? cleanDomain(sv as string) : null;
  const now = swap ? Date.now() : 0;

  const hostname = loc.hostname;
  const isLocalhost =
    hostname === 'localhost' ||
    hostname === '127.0.0.1' ||
    hostname.startsWith('localhost:') ||
    hostname.startsWith('127.0.0.1:');
  const isLocal = swap || isLocalhost;
  // vars.env keeps 2.0.0 semantics (localhost counts as local)
  const env: 'local' | 'staging' | 'production' = isLocal
    ? 'local'
    : hostname.endsWith('.webflow.io') || stagingHosts.includes(hostname.toLowerCase())
      ? 'staging'
      : 'production';

  // Opt-in global console mute only (legacy 1.x production behaviour)
  if (muteConsole && env === 'production' && !hasActiveSession) {
    try {
      const noop = () => {};
      console.log = console.warn = console.error = console.info = console.debug = noop;
    } catch (_) {}
  }

  type EventName = 'theme' | 'session';
  const listeners: Record<EventName, Set<(payload: unknown) => void>> = {
    theme: new Set(),
    session: new Set(),
  };
  const emit = (event: EventName, payload: unknown) =>
    listeners[event].forEach((fn) => {
      try {
        fn(payload);
      } catch (_) {}
    });

  // Eager client detection (2.0.0 behaviour: available at boot with live theme/viewport)
  const clientInfo = getClientInfo();

  try {
    // Mutate in place: vars.client.theme must stay the same object
    const updateTheme = () => emit('theme', { ...Object.assign(clientInfo.theme, getThemeInfo()) });
    ['dark', 'light'].forEach((scheme) => {
      const m: any = matchMedia(`(prefers-color-scheme: ${scheme})`);
      if (m.addEventListener) m.addEventListener('change', updateTheme);
      else if (m.addListener) m.addListener(updateTheme);
    });
  } catch (_) {}

  W.addEventListener('resize', () => {
    const v = clientInfo.viewport;
    v.width = W.innerWidth || 0;
    v.height = W.innerHeight || 0;
    v.dpr = W.devicePixelRatio || 1;
  });

  const stagepassObj = W.stagepass || {};
  const registry = createModuleRegistry(PKG_VERSION, spWarn);

  stagepassObj.vars = Object.freeze({
    isLocal,
    env,
    domain: dom || hostname,
    timestamp: now,
    version: PKG_VERSION,
    client: clientInfo,
  });

  stagepassObj.log = spLog;
  stagepassObj.warn = spWarn;
  stagepassObj.error = spError;

  /** Local HTTPS URL for a project-relative path, or '' without a swap session. */
  stagepassObj.resolveLocalUrl = (relativePath: string): string =>
    swap && dom && relativePath
      ? buildLocalAssetUrl(dom, relativePath, stagepassObj.vars.timestamp || Date.now())
      : '';

  stagepassObj.env = () => detectRuntimeEnv(hostname, dom, stagingHosts);
  stagepassObj.is = (name: string): boolean => stagepassObj.env() === name;
  stagepassObj.can = (capability: string): boolean => canCapability(clientInfo, capability);
  stagepassObj.client = (key?: string): unknown =>
    key == null || key === '' ? clientInfo : (clientInfo as any)[key];

  stagepassObj.on = (event: string, fn: (payload: unknown) => void): (() => void) => {
    const set = listeners[event as EventName];
    if (!set || (event !== 'theme' && event !== 'session')) return () => {};
    set.add(fn);
    return () => {
      set.delete(fn);
    };
  };

  stagepassObj.use = (
    name: string,
    version: string,
    factory: (api: Record<string, unknown>) => void
  ): boolean => registry.use(name, version, factory, stagepassObj);

  // Keep 2.0.0 behaviour: always assign `stagepass` and `sp` (removing `sp` would be breaking)
  W.stagepass = W.sp = stagepassObj;
  (globalThis as any).stagepass = (globalThis as any).sp = stagepassObj;

  // Optional custom alias only when the name is free and a valid identifier
  if (aliasName && isValidJsIdentifier(aliasName) && aliasName !== 'sp' && aliasName !== 'stagepass') {
    [W, globalThis].forEach((g) => {
      if (isGlobalFree(g, aliasName)) g[aliasName] = stagepassObj;
    });
  }

  // Dev flag: UI lives in flag.min.js next to the loader, fetched only during a session
  if (dev) {
    try {
      const FLAG = Symbol.for('stagepass.flag.v2');
      const src = (loaderScript && loaderScript.src) || '';
      // Flag chunks come from the same pinned path as the loader
      const base = /\/loader(?:\.min)?\.js$/i.test(src.split(/[?#]/)[0])
        ? new URL('./', src).href
        : `https://cdn.jsdelivr.net/npm/@stagepass/loader@${PKG_VERSION}/dist/`;
      Object.assign(flagState, {
        debug,
        domain: dom,
        card: base + 'flag-card.min.js',
        // End session is the only flag action that disconnects
        end: () => {
          clearSession();
          hasActiveSession = true;
          log('log', '🔌 Stagepass disconnected.');
          emit('session', { active: false, domain: null, swap: false, debug: false });
          loc.reload();
        },
      });
      Object.defineProperty(stagepassObj, FLAG, {
        configurable: true,
        value: (create: CreateFlag) => {
          delete stagepassObj[FLAG];
          try {
            renderFlag = create(flagState);
          } catch (_) {}
        },
      });
      // Capture phase also sees failed <script>/<link>/<img> loads
      W.addEventListener(
        'error',
        (e: any) => {
          const t = e.target;
          const u = t && t !== W && (t.src || t.href);
          if (typeof u === 'string')
            note(
              1,
              dom && !u.indexOf(`https://${dom}/`)
                ? `Local server not reachable: ${fileOf(u)}. Run stagepass doctor`
                : 'Failed to load ' + u,
              fileOf(u)
            );
          else note(1, e.message || 'Script error', fileOf(e.filename), e.lineno || '');
        },
        true
      );
      W.addEventListener('unhandledrejection', (e: any) => note(1, 'Unhandled rejection: ' + str(e.reason)));
      const s = d.createElement('script');
      s.src = base + 'flag.min.js';
      s.async = true;
      s.onerror = () => spWarn('Stagepass flag could not be loaded: ' + s.src);
      (d.head || d.documentElement).appendChild(s);
    } catch (_) {}
  }

  // Notify session listeners once at boot (after globals are set)
  emit('session', { active: hasActiveSession, domain: sv, swap, debug });

  function resolveAssetUrl(el: Element, productionSrc: string, localPath: string | null): string {
    if (swap && localPath && dom) return buildLocalAssetUrl(dom, localPath, now);
    const version = el.getAttribute('data-stagepass-v') || loaderVersionAttr;
    // data-stagepass-cachebust no longer timestamps every production view
    return version ? appendQueryParam(productionSrc, 'v', version) : productionSrc;
  }

  function extractLocalFilename(ps: string): string | null {
    try {
      const parts = new URL(ps).pathname.split('/');
      return parts[parts.length - 1] || parts[parts.length - 2] || null;
    } catch (e) {
      const m = ps.match(/\/([^\/\?#]+)(?:\?|#|$)/);
      return m ? m[1] : null;
    }
  }

  const SKIP = [
    'data-stagepass',
    'data-stagepass-path',
    'data-stagepass-cachebust',
    'data-stagepass-v',
  ];

  function swapEl(sel: string, srcAttr: string, type: 'script' | 'link', seen: Map<string, number>) {
    d.querySelectorAll(`${sel}:not([data-stagepass-processed])`).forEach((el: any) => {
      try {
        el.setAttribute('data-stagepass-processed', 'true');
        let lp = el.getAttribute('data-stagepass-path');
        const hadExplicitPath = !!lp;
        const ps = el.getAttribute(srcAttr);
        if (!ps) return;
        if (!lp && swap && dom) lp = extractLocalFilename(ps);
        // Two tagged assets resolve to the same local file without data-stagepass-path
        if (swap && lp && !hadExplicitPath && hasActiveSession) {
          const count = (seen.get(lp) || 0) + 1;
          seen.set(lp, count);
          if (count === 2) {
            spWarn(
              `Multiple assets resolve to local file "${lp}" without data-stagepass-path. Set unique paths to avoid collisions.`
            );
          }
        }
        const url = resolveAssetUrl(el, ps, lp);
        if (!url) return;
        if (swap && lp && dom) flagState.swapped++;
        const n: any = d.createElement(type);
        const isScript = type === 'script';
        if (isScript) n.src = url;
        else {
          n.rel = 'stylesheet';
          n.href = url;
        }
        for (const a of Array.from(el.attributes as NamedNodeMap)) {
          if (a.name !== srcAttr && !SKIP.includes(a.name) && (isScript || a.name !== 'href')) {
            n.setAttribute(a.name, a.value);
          }
        }
        if (isScript) applyScriptLoadOrder(n, el);
        if (el.parentNode) {
          el.parentNode.insertBefore(n, el);
          el.remove();
        } else {
          spError(`${type} injection failed: No parent node`);
        }
      } catch (_) {
        // Never break the page
      }
    });
  }

  const process = () => {
    try {
      const seen = new Map<string, number>();
      swapEl('script[data-stagepass]', 'data-src', 'script', seen);
      swapEl('link[rel="stylesheet"][data-stagepass]', 'data-href', 'link', seen);
      if (renderFlag) renderFlag();
    } catch (_) {}
  };

  // LNA check runs once per page (best-effort, never blocks rendering)
  let lnaCheck: Promise<void> | null = null;
  const checkLna = () =>
    (lnaCheck = lnaCheck || (swap
      ? queryLoopbackPermission()
          .then((state) => {
            const hint = lnaHintMessage(state);
            if (hint) spWarn(hint);
          })
          .catch(() => {})
      : Promise.resolve()));
  const run = () => {
    void checkLna().then(process);
  };

  run();
  if (d.readyState === 'loading') d.addEventListener('DOMContentLoaded', run);
})();
