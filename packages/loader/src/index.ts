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
import { applyScriptLoadOrder, isNoCacheEnabled, NOCACHE_ATTR } from './script-attrs.js';
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

  /**
   * Folder URL for the flag chunks, or null. Only http(s) after resolving against the page
   * (javascript:, data:, blob: and URLs with credentials are refused). `file` = the value is a
   * script URL, so its folder is used; otherwise the value is the folder itself.
   */
  function flagBase(v: unknown, file: boolean): string | null {
    if (typeof v !== 'string' || !(v = v.trim())) return null;
    try {
      const u = new URL(v as string, d.baseURI);
      if (!/^https?:$/.test(u.protocol) || u.username || u.password) return null;
      u.search = u.hash = '';
      return file ? new URL('./', u).href : u.href.replace(/\/?$/, '/');
    } catch (_) {
      return null;
    }
  }

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
  // Opt-in zero-cost mode: native src/href in production; swap only while a session is active
  const liveSrc = attr('live-src') === 'true';

  const p = new URLSearchParams(loc.search);

  let hasActiveSession = false;
  // Dev flag state (rendered by the lazy flag chunk once it has loaded).
  // Messages are plain text, grouped, capped to the latest 50 and truncated; the flag never parses HTML.
  const flagState = { n: [0, 0], m: [], f: [], swapped: 0, v: PKG_VERSION, vd: isValidDomain } as unknown as FlagState;
  let renderFlag: (() => void) | null = null;
  const draw = () => renderFlag && renderFlag();
  const time = () => new Date().toTimeString().slice(0, 8);
  const fileOf = (u: string) => (u || '').split(/[?#]/)[0].split('/').pop() || '';
  const cut = (t: string, n: number) => (t.length > n ? t.slice(0, n) + '…' : t);
  /** Safe text for any console argument (depth and size limited, never throws). */
  const str = (a: unknown, depth = 0): string => {
    try {
      if (typeof a === 'string') return depth ? JSON.stringify(a) : a;
      if (a instanceof Error) return a.name + ': ' + a.message;
      if (!a || typeof a !== 'object') return String(a);
      if (a instanceof Node) return '<' + a.nodeName.toLowerCase() + '>';
      const arr = Array.isArray(a);
      if (depth > 2) return arr ? '[…]' : '{…}';
      const keys = Object.keys(a);
      const out = keys.slice(0, 20).map((k) => (arr ? '' : k + ': ') + str((a as any)[k], depth + 1));
      if (keys.length > 20) out.push('…');
      return cut(arr ? '[' + out.join(', ') + ']' : '{' + out.join(', ') + '}', 1000);
    } catch (_) {
      return '[unserializable]';
    }
  };
  // First stack frame outside the loader: [url, line, col]
  const frame = (stack: string, skip = 0): string[] | null => {
    const lines = (stack || '').split('\n');
    for (let i = skip; i < lines.length; i++) {
      const m = lines[i].match(/([a-z][\w+.-]*:\/\/[^\s()]+?):(\d+):(\d+)/i);
      if (m && !LOADER_RE.test(fileOf(m[1]))) return [m[1], m[2], m[3]];
    }
    return null;
  };
  let dom: string | null = null;
  // local = served from the .sp domain, live = any other readable script, external = sanitized
  const srcOf = (u: string) => (!u ? 'external' : dom && !u.indexOf(`https://${dom}/`) ? 'local' : 'live');
  const note = (i: number, text: string, url = '', line: unknown = '', col: unknown = '', stack = '', src?: string) => {
    flagState.n[i]++;
    const m = flagState.m;
    const x = {
      type: i ? 'error' : 'warn',
      time: time(),
      src: src || (url ? srcOf(url) : ''),
      file: fileOf(url),
      url: url.split(/[?#]/)[0],
      line: line ? String(line) : '',
      col: col ? String(col) : '',
      text: cut(text, 500),
      stack: cut(stack, 2000),
      c: 1,
    } as any;
    const k = (y: any) => y.type + y.text + y.url + y.line + y.col;
    for (let j = m.length - 1; j >= 0; j--)
      if (k(m[j]) === k(x)) {
        x.c = m[j].c + 1;
        m.splice(j, 1);
        break;
      }
    m.push(x);
    if (m.length > 50) m.shift();
    draw();
  };
  const noteErr = (i: number, prefix: string, args: unknown[], at: string[] | null) => {
    const er = args.find((a) => a instanceof Error) as Error | undefined;
    const st = (er && er.stack) || '';
    const f = frame(st) || at;
    note(i, prefix + args.map((a) => str(a)).join(' '), f ? f[0] : '', f ? f[1] : '', f ? f[2] : '', st);
  };
  let busy = false;
  const print = (fn: () => void) => {
    busy = true;
    try {
      fn();
    } catch (_) {}
    busy = false;
  };

  function log(level: string, ...args: unknown[]) {
    if (!hasActiveSession) return;
    // First caller outside the loader: Error, log, sp.* wrapper, caller
    const at = frame(new Error().stack || '', 3);
    if (level === 'warn' || level === 'error') noteErr(level === 'warn' ? 0 : 1, '', args, at);
    print(() => {
      const pre = `[🎫 ${time()}${at ? ' | ' + fileOf(at[0]) + ':' + at[1] : ''}]`;
      const c = console as any;
      if (level === 'error') c.log(`%c${pre}`, 'color:red;font-weight:bold', ...args);
      else if (c[level]) c[level](pre, ...args);
      else c.log(pre, level, ...args);
    });
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
  dom = swap ? cleanDomain(sv as string) : null;
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

  // Eager client detection (2.0.0 behaviour: available at boot with live theme/viewport).
  // Lazy init was considered and rejected: theme/viewport listeners must run from boot anyway,
  // and deferring UA parsing would not shrink the core or stay trivially behaviour-identical.
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

  // Plain property (2.3.1 form): writable/configurable. Debug sessions get a one-time getter hint from the flag chunk.
  const varsFrozen = Object.freeze({
    isLocal,
    env,
    domain: dom || hostname,
    timestamp: now,
    version: PKG_VERSION,
    client: clientInfo,
  });
  stagepassObj.vars = varsFrozen;

  stagepassObj.log = spLog;
  stagepassObj.warn = spWarn;
  stagepassObj.error = spError;

  /** Local HTTPS URL for a project-relative path, or '' without a swap session. */
  stagepassObj.resolveLocalUrl = (relativePath: string): string =>
    swap && dom && relativePath
      ? buildLocalAssetUrl(dom, relativePath, varsFrozen.timestamp || Date.now())
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

  // Dev flag: UI lives in flag.min.js next to the loader (relative to its URL), fetched only during a session
  if (dev) {
    try {
      const FLAG = Symbol.for('stagepass.flag.v2');
      // Flag chunks: explicit base option, else the folder of the loader's own script URL
      // (any file name, so a self-hosted or npm-installed copy stays local). jsDelivr at the
      // same version only when neither exists (inline or bundled without the option).
      const opt = attr('flag-base') ?? W.stagepassFlagBase;
      let base = flagBase(opt, false);
      if (opt != null && !base) spWarn('Ignored flag base (http(s) or relative only): ' + cut(String(opt), 99));
      base = base || flagBase((loaderScript && loaderScript.src) || '', true);
      if (!base) {
        base = `https://cdn.jsdelivr.net/npm/@stagepass/loader@${PKG_VERSION}/dist/`;
        if (debug) spWarn('Loader URL unknown, flag loads from ' + base + '. Set data-stagepass-flag-base');
      }
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
      // Capture phase also sees failed <script>/<link>/<img> loads (swapped files report themselves)
      W.addEventListener(
        'error',
        (e: any) => {
          const t = e.target;
          const u = t && t !== W && (t.src || t.href);
          if (typeof u === 'string') {
            if (!mine.has(t)) note(1, 'Failed to load ' + u.split(/[?#]/)[0], u);
          } else if (/^Script error\.?$/.test(e.message || '') && !e.filename)
            // Sanitized by the browser: the script came from another origin without CORS
            note(1, 'Error in a cross-origin script (details only in DevTools console)', '', '', '', '', 'external');
          else
            note(1, e.message || 'Script error', e.filename || '', e.lineno, e.colno, (e.error && e.error.stack) || '');
        },
        true
      );
      W.addEventListener('unhandledrejection', (e: any) => noteErr(1, 'Unhandled rejection: ', [e.reason], null));
      // console.warn/error from page code (the original always runs, our own output is skipped)
      const c = console as any;
      ['warn', 'error'].forEach((k, i) => {
        const o = c[k];
        if (typeof o !== 'function') return;
        c[k] = function (this: unknown, ...args: unknown[]) {
          if (!busy) {
            busy = true;
            try {
              noteErr(i, '', args, frame(new Error().stack || '', 2));
            } catch (_) {}
            busy = false;
          }
          return o.apply(this, args);
        };
      });
      const s = d.createElement('script');
      s.src = base + 'flag.min.js';
      s.async = true;
      s.onerror = () => spWarn('Stagepass flag could not be loaded: ' + s.src);
      (d.head || d.documentElement).appendChild(s);
      // Live reload is bootstrapped by the flag chunk (same folder as flag-card.min.js).
    } catch (_) {}
  }

  // Notify session listeners once at boot (after globals are set)
  emit('session', { active: hasActiveSession, domain: sv, swap, debug });

  function resolveAssetUrl(el: Element, productionSrc: string, localPath: string | null): string {
    if (swap && localPath && dom) return buildLocalAssetUrl(dom, localPath, now);
    const version = el.getAttribute('data-stagepass-v') || loaderVersionAttr;
    // data-stagepass-cachebust no longer timestamps every production view
    let url = version ? appendQueryParam(productionSrc, 'v', version) : productionSrc;
    // nocache: exactly one fresh _cb (an existing query `_cb` is replaced; path and hash stay)
    if (isNoCacheEnabled(el)) url = appendQueryParam(url, '_cb', Date.now());
    return url;
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

  // Swapped files: status per file; "swapped" counts only files that loaded.
  // f.x = true when data-stagepass-path was explicit (flag chunk warns on non-explicit dups).
  const mine = new WeakSet<Element>();
  let lnaState = '';
  function track(
    n: any,
    live: string,
    local: string,
    isScript: boolean,
    retry: ((cors: boolean) => any) | null,
    explicit?: boolean
  ) {
    const f: any = { live, local, type: isScript ? 'js' : 'css', st: '' };
    if (explicit) f.x = true;
    const name = fileOf(local);
    mine.add(n);
    flagState.f.push(f);
    n.addEventListener('load', () => {
      f.st = 'ok';
      flagState.swapped++;
      draw();
    });
    n.addEventListener('error', () => {
      const fail = (st: string, i: number, text: string) => {
        f.st = st;
        note(i, text, local);
      };
      const F = W.fetch;
      if (typeof F !== 'function') return fail('failed', 1, `Failed to load ${name}`);
      // CORS HEAD probe (the local server sends Access-Control-Allow-Origin, also on 404)
      F(local, { method: 'HEAD', cache: 'no-store' }).then(
        (r: any) => fail(r.ok ? 'failed' : String(r.status), 1, r.ok ? `Failed to load ${name}` : `Local file not found (${r.status}): ${name}`),
        () =>
          F(local, { method: 'HEAD', mode: 'no-cors', cache: 'no-store' }).then(
            () => {
              // Reachable but without CORS headers: load again without crossorigin
              if (!retry) return fail('failed', 1, `Failed to load ${name}`);
              flagState.f.splice(flagState.f.indexOf(f), 1);
              n.replaceWith(retry(false));
              note(0, `Local server sends no CORS header for ${name}. Loaded without crossorigin, error details are limited`, local);
            },
            () =>
              fail('failed', 1, `Local server not reachable: ${name}. Run stagepass doctor` + (lnaHintMessage(lnaState as any) ? '. ' + lnaHintMessage(lnaState as any) : ''))
          )
      );
    });
  }

  const SKIP = [
    'data-stagepass',
    'data-stagepass-path',
    'data-stagepass-cachebust',
    'data-stagepass-v',
    NOCACHE_ATTR,
  ];

  // live-src tags: native src/href, not legacy data-src/data-href, not processed yet
  const LS =
    'script[data-stagepass][src]:not([data-src]):not([data-stagepass-processed]),link[rel="stylesheet" i][data-stagepass][href]:not([data-href]):not([data-stagepass-processed])';
  // Firefox: MO often runs after prepare; feature-detect beforescriptexecute (InstallTrigger is hidden).
  const ff = 'onbeforescriptexecute' in d;

  // Minimal live-src hook must stay in core (MO before parser prepares a script). Only called in swap sessions.
  function rewriteLive(el: any) {
    try {
      const js = el.tagName === 'SCRIPT';
      // Firefox scripts: beforescriptexecute path. Already-executing script: silent skip.
      if (js && (ff || d.currentScript === el)) return;
      const k = js ? 'src' : 'href';
      const ps = el.getAttribute(k);
      if (!ps) return;
      el.setAttribute('data-stagepass-processed', 'true');
      const x = el.getAttribute('data-stagepass-path');
      const lp = x || extractLocalFilename(ps);
      if (!lp) return;
      const url = buildLocalAssetUrl(dom as string, lp, now);
      el.removeAttribute('integrity');
      if (!el.hasAttribute('crossorigin')) el.setAttribute('crossorigin', 'anonymous');
      el[k] = url;
      track(el, ps, url, js, null, !!x);
    } catch (_) {}
  }
  const scanLive = (r: any) => {
    try {
      if (r.matches && r.matches(LS)) rewriteLive(r);
      r.querySelectorAll(LS).forEach(rewriteLive);
    } catch (_) {}
  };

  function swapEl(sel: string, srcAttr: string, type: 'script' | 'link') {
    d.querySelectorAll(`${sel}:not([data-stagepass-processed])`).forEach((el: any) => {
      try {
        let lp = el.getAttribute('data-stagepass-path');
        const hadExplicitPath = !!lp;
        const ps = el.getAttribute(srcAttr);
        // Do not mark processed when data-src/data-href is missing (live-src tags need a later pass)
        if (!ps) return;
        el.setAttribute('data-stagepass-processed', 'true');
        if (!lp && swap && dom) lp = extractLocalFilename(ps);
        const url = resolveAssetUrl(el, ps, lp);
        if (!url) return;
        const local = swap && lp && dom;
        const isScript = type === 'script';
        const make = (cors: boolean) => {
          const n: any = d.createElement(type);
          // CORS mode: errors in local files keep message, location and stack
          if (cors) n.crossOrigin = 'anonymous';
          if (isScript) n.src = url;
          else {
            n.rel = 'stylesheet';
            n.href = url;
          }
          for (const a of Array.from(el.attributes as NamedNodeMap)) {
            // Never copy production src onto the new script (Firefox live-src converts via data-src)
            // Never copy the production src/href (live-src tags converted to data-src keep none, but be safe)
            if (a.name !== srcAttr && !SKIP.includes(a.name) && a.name !== (isScript ? 'src' : 'href'))
              n.setAttribute(a.name, a.value);
          }
          if (local) n.removeAttribute('integrity');
          if (isScript) applyScriptLoadOrder(n, el);
          if (local) track(n, ps, url, isScript, cors ? make : null, hadExplicitPath);
          return n;
        };
        const n = make(!!local && !el.hasAttribute('crossorigin'));
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

  if (swap && liveSrc) {
    try {
      // Chromium / WebKit: MO runs at the parser microtask checkpoint before "prepare a script".
      new MutationObserver((ms) => {
        for (const m of ms) for (const n of m.addedNodes) if (n.nodeType === 1) scanLive(n);
      }).observe(d.documentElement, { childList: true, subtree: true });
      // Firefox: cancel production run, convert to legacy data-src, let swapEl create the replacement.
      if (ff)
        d.addEventListener(
          'beforescriptexecute',
          (e: Event) => {
            const el = e.target as HTMLScriptElement;
            if (!el || !el.matches || !el.matches(LS)) return;
            const ps = el.getAttribute('src');
            if (!ps || ps.indexOf('https://' + dom + '/') === 0) return;
            e.preventDefault();
            el.setAttribute('data-src', ps);
            el.removeAttribute('src');
            swapEl('script[data-stagepass]', 'data-src', 'script');
          },
          true
        );
      scanLive(d);
    } catch (_) {}
  }

  const process = () => {
    try {
      swapEl('script[data-stagepass]', 'data-src', 'script');
      swapEl('link[rel="stylesheet"][data-stagepass]', 'data-href', 'link');
      if (swap && liveSrc) scanLive(d);
      if (renderFlag) renderFlag();
    } catch (_) {}
  };

  // LNA check runs once per page (best-effort, never blocks rendering)
  let lnaCheck: Promise<void> | null = null;
  const checkLna = () =>
    (lnaCheck = lnaCheck || (swap
      ? queryLoopbackPermission()
          .then((state) => {
            lnaState = state;
          })
          .catch(() => {})
      : Promise.resolve()));
  const run = () => {
    void checkLna().then(process);
  };

  run();
  if (d.readyState === 'loading') d.addEventListener('DOMContentLoaded', run);
})();
