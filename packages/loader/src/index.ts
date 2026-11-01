import { cleanDomain, isValidDomain } from './domain.js';
import {
  SESSION_KEY,
  createSession,
  parseSession,
  parseSessionHours,
  serializeSession,
} from './session.js';
import { appendQueryParam, buildLocalAssetUrl } from './url.js';
import { lnaHintMessage, queryLoopbackPermission, type LnaState } from './lna.js';
import { applyScriptLoadOrder } from './script-attrs.js';
import { detectRuntimeEnv, parseStagingHosts } from './env.js';
import { isGlobalFree, isValidJsIdentifier } from './alias.js';
import {
  canCapability,
  getClientInfo,
  type StagepassClientInfo,
} from './client.js';
import { createModuleRegistry } from './registry.js';

declare const __STAGEPASS_VERSION__: string;

(function () {
  const K = SESSION_KEY;
  const P = 'stagepass';
  const PKG_VERSION =
    typeof __STAGEPASS_VERSION__ !== 'undefined' ? __STAGEPASS_VERSION__ : '0.0.0';

  function getLoaderScript(): HTMLScriptElement | null {
    try {
      if (document.currentScript instanceof HTMLScriptElement) {
        return document.currentScript;
      }
    } catch (_) {}
    try {
      const scripts = document.querySelectorAll('script[src*="loader"]');
      for (let i = scripts.length - 1; i >= 0; i--) {
        const s = scripts[i] as HTMLScriptElement;
        if (/loader(?:\.min)?\.js/i.test(s.src || '')) return s;
      }
    } catch (_) {}
    return null;
  }

  const loaderScript = getLoaderScript();
  const muteConsole =
    loaderScript?.getAttribute('data-stagepass-mute-console') === 'true';
  const sessionHours = parseSessionHours(
    loaderScript?.getAttribute('data-stagepass-session-hours')
  );
  const loaderVersionAttr = loaderScript?.getAttribute('data-stagepass-version');
  const stagingHosts = parseStagingHosts(
    loaderScript?.getAttribute('data-stagepass-staging-hosts')
  );
  const aliasName = loaderScript?.getAttribute('data-stagepass-alias');

  const p = new URLSearchParams(window.location.search);

  function getCallerLocation(): string {
    try {
      const stack = new Error().stack?.split('\n');
      if (!stack) return '';
      const loaderPattern = /loader(?:\.min)?\.js/i;
      for (let i = 3; i < stack.length; i++) {
        const line = stack[i];
        const match = line.match(/([^/]+\.(?:js|ts))(?:[?#][^:]*)?:(\d+)/);
        if (match) {
          const file = match[1];
          if (!loaderPattern.test(file)) return ` ${file}:${match[2]}`;
        }
      }
    } catch (_) {}
    return '';
  }

  let hasActiveSession = false;

  function log(level: string, ...args: unknown[]) {
    if (!hasActiveSession) return;
    try {
      const t = new Date().toTimeString().split(' ')[0];
      const loc = getCallerLocation();
      const pre = `[🎫 ${t}${loc ? ' |' + loc : ''}]`;
      if (level === 'error') {
        console.log(`%c${pre}`, 'color: red; font-weight: bold;', ...args);
      } else if (console[level as keyof Console]) {
        (console[level as keyof Console] as Function)(pre, ...args);
      } else {
        console.log(pre, level, ...args);
      }
    } catch (_) {}
  }

  function spLog(...args: unknown[]) {
    let level = 'log';
    if (args.length > 0 && (args[0] === 'warn' || args[0] === 'error')) {
      level = args[0] as string;
      args = args.slice(1);
    }
    log(level, ...args);
  }
  const spWarn = (...args: unknown[]) => log('warn', ...args);
  const spError = (...args: unknown[]) => log('error', ...args);

  function readSessionDomain(): string | null {
    try {
      const raw = localStorage.getItem(K);
      const record = parseSession(raw);
      if (!record) {
        if (raw) localStorage.removeItem(K);
        return null;
      }
      return record.domain;
    } catch (_) {
      return null;
    }
  }

  function writeSession(domain: string): void {
    try {
      const record = createSession(domain, sessionHours);
      localStorage.setItem(K, serializeSession(record));
    } catch (_) {}
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
      hasActiveSession = true; // allow one disconnect log
      log('log', '🔌 Stagepass disconnected.');
      hasActiveSession = false;
    } else if (v) {
      const c = v === 'debug' ? 'debug' : cleanDomain(v);
      if (c && isValidDomain(c)) {
        writeSession(c);
        sv = c;
        hasActiveSession = true;
        log(
          'log',
          c === 'debug'
            ? '🔍 Stagepass debug mode enabled.'
            : `🔌 Stagepass connected to: ${c}`
        );
        paramProcessed = true;
      } else if (c) {
        hasActiveSession = true;
        spWarn(`Invalid domain: ${c}. Only .sp domains are allowed.`);
        hasActiveSession = false;
      }
    }
    try {
      p.delete(P);
      const s = p.toString();
      window.history.replaceState(
        {},
        '',
        window.location.pathname + (s ? `?${s}` : '') + window.location.hash
      );
    } catch (_) {}
  }

  if (sv && !isValidDomain(sv)) {
    clearSession();
    sv = null;
  }

  hasActiveSession = !!(sv && isValidDomain(sv));
  if (sv && !paramProcessed && sv !== 'debug' && hasActiveSession) {
    log('log', `🔌 Stagepass connected to: ${sv}`);
  }

  const dev = !!sv;
  const swap = !!sv && sv !== 'debug';
  const dom = swap ? cleanDomain(sv) : null;
  const now = swap ? Date.now() : 0;
  const cacheBust = now;
  const sessionStartTime = now;

  const hostname = window.location.hostname;
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

  // Event subscribers
  type EventName = 'theme' | 'session';
  const listeners: Record<EventName, Set<(payload: unknown) => void>> = {
    theme: new Set(),
    session: new Set(),
  };

  function emit(event: EventName, payload: unknown) {
    listeners[event].forEach((fn) => {
      try {
        fn(payload);
      } catch (_) {}
    });
  }

  // Eager client detection (2.0.0 behaviour: available at boot with live theme/viewport)
  let clientInfo: StagepassClientInfo = getClientInfo();

  function ensureClient(): StagepassClientInfo {
    return clientInfo;
  }

  try {
    if (window.matchMedia) {
      const darkMq = window.matchMedia('(prefers-color-scheme: dark)');
      const lightMq = window.matchMedia('(prefers-color-scheme: light)');
      const updateTheme = () => {
        const c = clientInfo;
        if (!c?.theme) return;
        if (darkMq.matches) {
          c.theme.current = 'dark';
          c.theme.preferred = 'dark';
        } else if (lightMq.matches) {
          c.theme.current = 'light';
          c.theme.preferred = 'light';
        } else {
          c.theme.current = 'unknown';
          c.theme.preferred = 'no-preference';
        }
        emit('theme', { ...c.theme });
      };
      if (typeof darkMq.addEventListener === 'function') {
        darkMq.addEventListener('change', updateTheme);
        lightMq.addEventListener('change', updateTheme);
      } else if (typeof (darkMq as any).addListener === 'function') {
        (darkMq as any).addListener(updateTheme);
        (lightMq as any).addListener(updateTheme);
      }
    }
  } catch (_) {}

  const updateViewport = () => {
    const c = clientInfo;
    if (!c?.viewport) return;
    c.viewport.width = window.innerWidth || 0;
    c.viewport.height = window.innerHeight || 0;
    c.viewport.dpr = window.devicePixelRatio || 1;
  };
  window.addEventListener('resize', updateViewport);

  const stagepassObj = (window as any).stagepass || {};
  const registry = createModuleRegistry(PKG_VERSION, spWarn);

  stagepassObj.vars = Object.freeze({
    isLocal,
    env,
    domain: dom || hostname,
    timestamp: sessionStartTime,
    version: PKG_VERSION,
    client: clientInfo,
  });

  stagepassObj.log = spLog;
  stagepassObj.warn = spWarn;
  stagepassObj.error = spError;

  /**
   * Build a local HTTPS URL when a Stagepass session is active.
   * @param relativePath - Path relative to the linked project root
   * @returns Local URL or empty string when no session
   */
  stagepassObj.resolveLocalUrl = (relativePath: string): string => {
    const v = stagepassObj.vars;
    if (!swap || !dom || !relativePath) return '';
    return buildLocalAssetUrl(dom, relativePath, v.timestamp || Date.now());
  };

  // Flat helpers (additive)
  stagepassObj.env = (): 'local' | 'staging' | 'production' =>
    detectRuntimeEnv(hostname, dom, stagingHosts);

  stagepassObj.is = (name: string): boolean => stagepassObj.env() === name;

  stagepassObj.can = (capability: string): boolean =>
    canCapability(ensureClient(), capability);

  stagepassObj.client = (key?: string): unknown => {
    const c = ensureClient();
    if (key == null || key === '') return c;
    return (c as Record<string, unknown>)[key];
  };

  stagepassObj.on = (event: string, fn: (payload: unknown) => void): (() => void) => {
    if (event !== 'theme' && event !== 'session') {
      return () => {};
    }
    const set = listeners[event as EventName];
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

  (window as any).stagepass = stagepassObj;
  (globalThis as any).stagepass = stagepassObj;
  // Keep 2.0.0 behaviour: always assign `sp` (removing this would be breaking)
  (window as any).sp = stagepassObj;
  (globalThis as any).sp = stagepassObj;

  // Optional custom alias only when the name is free and a valid identifier
  if (aliasName && isValidJsIdentifier(aliasName) && aliasName !== 'sp' && aliasName !== 'stagepass') {
    if (isGlobalFree(window, aliasName)) {
      (window as any)[aliasName] = stagepassObj;
    }
    if (isGlobalFree(globalThis, aliasName)) {
      (globalThis as any)[aliasName] = stagepassObj;
    }
  }

  // Notify session listeners once at boot (after globals are set)
  emit('session', {
    active: hasActiveSession,
    domain: sv,
    swap,
    debug: sv === 'debug',
  });

  let lnaState: LnaState = 'unknown';
  let lnaHint: string | null = null;

  function resolveAssetUrl(
    el: Element,
    productionSrc: string,
    localPath: string | null
  ): string {
    if (swap && localPath && dom) {
      return buildLocalAssetUrl(dom, localPath, cacheBust);
    }

    const perAssetVersion = el.getAttribute('data-stagepass-v');
    const version = perAssetVersion || loaderVersionAttr;
    if (version) {
      return appendQueryParam(productionSrc, 'v', version);
    }

    // data-stagepass-cachebust no longer timestamps every production view
    return productionSrc;
  }

  function extractLocalFilename(ps: string): string | null {
    try {
      const urlObj = new URL(ps);
      const pathParts = urlObj.pathname.split('/');
      return pathParts[pathParts.length - 1] || pathParts[pathParts.length - 2] || null;
    } catch (e) {
      const match = ps.match(/\/([^\/\?#]+)(?:\?|#|$)/);
      return match ? match[1] : null;
    }
  }

  function swapEl(
    sel: string,
    pathAttr: string,
    srcAttr: string,
    type: 'script' | 'link',
    skipAttrs: string[],
    seenLocalNames: Map<string, number>
  ) {
    document.querySelectorAll(`${sel}:not([data-stagepass-processed])`).forEach((el: any) => {
      try {
        el.setAttribute('data-stagepass-processed', 'true');
        let lp = el.getAttribute(pathAttr);
        const hadExplicitPath = !!lp;
        const ps = el.getAttribute(srcAttr);
        if (!ps) return;
        if (!lp && ps && swap && dom) {
          lp = extractLocalFilename(ps);
        }
        // Debug warning: two tagged assets resolve to the same local file without data-stagepass-path
        if (swap && lp && !hadExplicitPath && hasActiveSession) {
          const key = lp;
          const count = (seenLocalNames.get(key) || 0) + 1;
          seenLocalNames.set(key, count);
          if (count === 2) {
            spWarn(
              `Multiple assets resolve to local file "${key}" without data-stagepass-path. Set unique paths to avoid collisions.`
            );
          }
        }
        const url = resolveAssetUrl(el, ps, lp);
        if (!url) return;
        const n = document.createElement(type);
        if (type === 'script') {
          (n as HTMLScriptElement).src = url;
          Array.from(el.attributes).forEach((a) => {
            const attr = a as Attr;
            if (!skipAttrs.includes(attr.name)) n.setAttribute(attr.name, attr.value);
          });
          applyScriptLoadOrder(n as HTMLScriptElement, el);
        } else {
          (n as HTMLLinkElement).rel = 'stylesheet';
          (n as HTMLLinkElement).href = url;
          Array.from(el.attributes).forEach((a) => {
            const attr = a as Attr;
            if (!skipAttrs.includes(attr.name)) n.setAttribute(attr.name, attr.value);
          });
        }
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
      const seenLocalNames = new Map<string, number>();
      swapEl(
        'script[data-stagepass]',
        'data-stagepass-path',
        'data-src',
        'script',
        [
          'data-src',
          'data-stagepass',
          'data-stagepass-path',
          'data-stagepass-cachebust',
          'data-stagepass-v',
        ],
        seenLocalNames
      );
      swapEl(
        'link[rel="stylesheet"][data-stagepass]',
        'data-stagepass-path',
        'data-href',
        'link',
        [
          'href',
          'data-href',
          'data-stagepass',
          'data-stagepass-path',
          'data-stagepass-cachebust',
          'data-stagepass-v',
        ],
        seenLocalNames
      );
    } catch (_) {}
  };

  function updateFlagText(flag: HTMLElement) {
    let text = sv === 'debug' ? 'STAGEPASS DEBUG' : 'STAGEPASS ACTIVE';
    if (lnaHint) {
      text = sv === 'debug' ? 'STAGEPASS DEBUG · LNA' : 'STAGEPASS · ALLOW LOCAL NETWORK';
    }
    flag.textContent = text;
    if (lnaHint) {
      flag.title = lnaHint;
    }
  }

  function flag() {
    if (!dev) return;
    try {
      const f = document.createElement('div');
      f.id = 'stagepass-flag';
      updateFlagText(f);
      f.style.cssText =
        'font:12px/1 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;font-weight:bold;color:#fff;background:#D92662;padding:4px 6px;z-index:9999999999;position:fixed;top:0;right:0;cursor:pointer;border-radius:0 0 0 4px;user-select:none;';
      f.addEventListener('click', () => {
        clearSession();
        hasActiveSession = true;
        log('log', '🔌 Stagepass disconnected.');
        emit('session', { active: false, domain: null, swap: false, debug: false });
        window.location.reload();
      });
      const mount = () => {
        if (document.body) document.body.appendChild(f);
      };
      if (document.body) mount();
      else document.addEventListener('DOMContentLoaded', mount);

      // Keep a reference so LNA async can update the badge
      (stagepassObj as any).__flagEl = f;
    } catch (_) {}
  }

  async function maybeCheckLnaAndProcess() {
    if (swap) {
      try {
        lnaState = await queryLoopbackPermission();
        lnaHint = lnaHintMessage(lnaState);
        if (lnaHint) {
          spWarn(lnaHint);
          const flagEl = (stagepassObj as any).__flagEl as HTMLElement | undefined;
          if (flagEl) updateFlagText(flagEl);
        }
      } catch (_) {
        lnaState = 'unknown';
        lnaHint = null;
      }
    }
    process();
  }

  // Start processing: never block rendering; LNA check is best-effort
  void maybeCheckLnaAndProcess();
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      void maybeCheckLnaAndProcess();
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', flag);
  } else {
    flag();
  }

})();
