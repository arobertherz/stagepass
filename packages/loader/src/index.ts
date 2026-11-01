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
  const env: 'local' | 'staging' | 'production' = isLocal
    ? 'local'
    : hostname.endsWith('.webflow.io')
      ? 'staging'
      : 'production';

  // Opt-in global console mute only (legacy 1.x production behaviour)
  if (muteConsole && env === 'production' && !hasActiveSession) {
    try {
      const noop = () => {};
      console.log = console.warn = console.error = console.info = console.debug = noop;
    } catch (_) {}
  }

  type StagepassClientTheme = {
    preferred: 'light' | 'dark' | 'no-preference';
    current: 'light' | 'dark' | 'unknown';
  };

  type StagepassClientInfo = {
    theme: StagepassClientTheme;
    browser: {
      family: 'chrome' | 'safari' | 'firefox' | 'edge' | 'opera' | 'unknown';
      major: number | null;
      userAgent: string;
    };
    os: {
      family: 'macos' | 'windows' | 'ios' | 'android' | 'linux' | 'unknown';
    };
    device: {
      type: 'mobile' | 'tablet' | 'desktop' | 'unknown';
      touch: boolean;
    };
    viewport: {
      width: number;
      height: number;
      dpr: number;
    };
    locale: {
      language: string;
      timezone: string | null;
    };
    capabilities: {
      cookiesEnabled: boolean;
      localStorage: boolean;
      sessionStorage: boolean;
    };
  };

  function getBrowserInfo(ua: string): StagepassClientInfo['browser'] {
    let family: StagepassClientInfo['browser']['family'] = 'unknown';
    let major: number | null = null;
    let m: RegExpMatchArray | null = null;

    if (/Edg\/(\d+)/.test(ua)) {
      family = 'edge';
      m = ua.match(/Edg\/(\d+)/);
    } else if (/OPR\/(\d+)/.test(ua)) {
      family = 'opera';
      m = ua.match(/OPR\/(\d+)/);
    } else if (/Firefox\/(\d+)/.test(ua)) {
      family = 'firefox';
      m = ua.match(/Firefox\/(\d+)/);
    } else if (/Chrome\/(\d+)/.test(ua)) {
      family = 'chrome';
      m = ua.match(/Chrome\/(\d+)/);
    } else if (/Version\/(\d+).+Safari\//.test(ua)) {
      family = 'safari';
      m = ua.match(/Version\/(\d+)/);
    }

    if (m && m[1]) major = Number(m[1]);
    return { family, major: Number.isFinite(major) ? major : null, userAgent: ua };
  }

  function getOsInfo(ua: string): StagepassClientInfo['os'] {
    if (/Android/i.test(ua)) return { family: 'android' };
    if (/iPhone|iPad|iPod/i.test(ua)) return { family: 'ios' };
    if (/Mac OS X|Macintosh/i.test(ua)) return { family: 'macos' };
    if (/Windows NT/i.test(ua)) return { family: 'windows' };
    if (/Linux/i.test(ua)) return { family: 'linux' };
    return { family: 'unknown' };
  }

  function getDeviceInfo(ua: string): StagepassClientInfo['device'] {
    const touch = 'ontouchstart' in window || (navigator.maxTouchPoints || 0) > 0;
    let type: StagepassClientInfo['device']['type'] = 'desktop';
    if (/iPad|Tablet/i.test(ua)) type = 'tablet';
    else if (/Mobi|Android.+Mobile|iPhone/i.test(ua)) type = 'mobile';
    else if (/Android/i.test(ua) && touch) type = 'tablet';
    return { type, touch };
  }

  function getThemeInfo(): StagepassClientTheme {
    let preferred: StagepassClientTheme['preferred'] = 'no-preference';
    let current: StagepassClientTheme['current'] = 'unknown';
    try {
      if (window.matchMedia) {
        if (window.matchMedia('(prefers-color-scheme: dark)').matches) {
          preferred = 'dark';
          current = 'dark';
        } else if (window.matchMedia('(prefers-color-scheme: light)').matches) {
          preferred = 'light';
          current = 'light';
        }
      }
    } catch (_) {}
    return { preferred, current };
  }

  function hasStorage(type: 'localStorage' | 'sessionStorage'): boolean {
    try {
      const storage = window[type];
      const key = '__stagepass_test__';
      storage.setItem(key, '1');
      storage.removeItem(key);
      return true;
    } catch (_) {
      return false;
    }
  }

  function getClientInfo(): StagepassClientInfo {
    const ua = navigator.userAgent || '';
    let timezone: string | null = null;
    try {
      timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || null;
    } catch (_) {}
    return {
      theme: getThemeInfo(),
      browser: getBrowserInfo(ua),
      os: getOsInfo(ua),
      device: getDeviceInfo(ua),
      viewport: {
        width: window.innerWidth || 0,
        height: window.innerHeight || 0,
        dpr: window.devicePixelRatio || 1,
      },
      locale: {
        language: navigator.language || 'unknown',
        timezone,
      },
      capabilities: {
        cookiesEnabled: navigator.cookieEnabled === true,
        localStorage: hasStorage('localStorage'),
        sessionStorage: hasStorage('sessionStorage'),
      },
    };
  }

  const stagepassObj = (window as any).stagepass || {};
  const clientInfo = getClientInfo();
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
  (window as any).stagepass = stagepassObj;
  (globalThis as any).stagepass = stagepassObj;
  (window as any).sp = stagepassObj;
  (globalThis as any).sp = stagepassObj;

  try {
    if (window.matchMedia) {
      const darkMq = window.matchMedia('(prefers-color-scheme: dark)');
      const lightMq = window.matchMedia('(prefers-color-scheme: light)');
      const updateTheme = () => {
        if (!stagepassObj.vars?.client?.theme) return;
        if (darkMq.matches) {
          stagepassObj.vars.client.theme.current = 'dark';
          stagepassObj.vars.client.theme.preferred = 'dark';
        } else if (lightMq.matches) {
          stagepassObj.vars.client.theme.current = 'light';
          stagepassObj.vars.client.theme.preferred = 'light';
        } else {
          stagepassObj.vars.client.theme.current = 'unknown';
          stagepassObj.vars.client.theme.preferred = 'no-preference';
        }
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
    if (!stagepassObj.vars?.client?.viewport) return;
    stagepassObj.vars.client.viewport.width = window.innerWidth || 0;
    stagepassObj.vars.client.viewport.height = window.innerHeight || 0;
    stagepassObj.vars.client.viewport.dpr = window.devicePixelRatio || 1;
  };
  window.addEventListener('resize', updateViewport);

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

  function swapEl(
    sel: string,
    pathAttr: string,
    srcAttr: string,
    type: 'script' | 'link',
    skipAttrs: string[]
  ) {
    document.querySelectorAll(`${sel}:not([data-stagepass-processed])`).forEach((el: any) => {
      try {
        el.setAttribute('data-stagepass-processed', 'true');
        let lp = el.getAttribute(pathAttr);
        const ps = el.getAttribute(srcAttr);
        if (!ps) return;
        if (!lp && ps && swap && dom) {
          try {
            const urlObj = new URL(ps);
            const pathParts = urlObj.pathname.split('/');
            lp = pathParts[pathParts.length - 1] || pathParts[pathParts.length - 2];
          } catch (e) {
            const match = ps.match(/\/([^\/\?#]+)(?:\?|#|$)/);
            if (match) lp = match[1];
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
      swapEl('script[data-stagepass]', 'data-stagepass-path', 'data-src', 'script', [
        'data-src',
        'data-stagepass',
        'data-stagepass-path',
        'data-stagepass-cachebust',
        'data-stagepass-v',
      ]);
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
        ]
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
