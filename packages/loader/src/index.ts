(function () {
  const K = 'stagepass_domain';
  const P = 'stagepass';
  
  const isValidDomain = (d: string): boolean => d === 'debug' || d.endsWith('.sp') || d === 'localhost' || d.startsWith('localhost:');
  
  const p = new URLSearchParams(window.location.search);
  
  // Get parameters from the loader script tag itself (not from page URL)
  const loaderScript = document.querySelector('script[src*="loader"]') as HTMLScriptElement;
  let modulesParam: string | null = null;
  let silentParam: string | null = null;
  
  if (loaderScript && loaderScript.src) {
    try {
      const scriptUrl = new URL(loaderScript.src);
      modulesParam = scriptUrl.searchParams.get('modules');
      silentParam = scriptUrl.searchParams.get('silent');
    } catch (e) {
      // Fallback: try to extract from src string
      const modulesMatch = loaderScript.src.match(/[?&]modules(=([^&]*))?/);
      if (modulesMatch) {
        modulesParam = modulesMatch[2] !== undefined ? modulesMatch[2] : '';
      }
      const silentMatch = loaderScript.src.match(/[?&]silent/);
      if (silentMatch) {
        silentParam = '';
      }
    }
  }
  
  function log(level: string, ...args: any[]) {
    const v = localStorage.getItem(K);
    if (!v) return;
    const t = new Date().toTimeString().split(' ')[0];
    let c = '';
    try {
      const s = new Error().stack?.split('\n');
      if (s) {
        const l = s.find((x, i) => i > 2 && !x.includes('log'));
        if (l) {
          const m = l.match(/:([0-9]+):/);
          if (m) c = `:${m[1]}`;
        }
      }
    } catch (e) {}
    const pre = `[🎫 ${t}${c ? ' 📍' + c : ''}]`;
    if (level === 'error') {
      console.log(`%c${pre}`, 'color: red; font-weight: bold;', ...args);
    } else if (console[level as keyof Console]) {
      (console[level as keyof Console] as Function)(pre, ...args);
    } else {
      console.log(pre, level, ...args);
    }
  }

  const splog = (...args: any[]) => log('log', ...args);
  const spwarn = (...args: any[]) => log('warn', ...args);
  const sperror = (...args: any[]) => log('error', ...args);
  (window as any).splog = splog;
  (window as any).spwarn = spwarn;
  (window as any).sperror = sperror;

  const clean = (d: string | null): string | null => d ? d.replace(/^https?:\/\//, '').replace(/\/$/, '') : null;

  let paramProcessed = false;
  let sv = localStorage.getItem(K);
  
  if (p.has(P)) {
    const v = p.get(P);
    if (v === 'off' || v === '0' || v === 'false') {
      localStorage.removeItem(K);
      sv = null;
      splog('🔌 Stagepass disconnected.');
    } else if (v) {
      const c = v === 'debug' ? 'debug' : clean(v);
      if (c && isValidDomain(c)) {
        localStorage.setItem(K, c);
        sv = c;
        splog(c === 'debug' ? '🔍 Stagepass debug mode enabled.' : `🔌 Stagepass connected to: ${c}`);
        paramProcessed = true;
      } else if (c) {
        spwarn(`Invalid domain: ${c}. Only .sp domains are allowed.`);
      }
    }
    p.delete(P);
    const s = p.toString();
    window.history.replaceState({}, '', window.location.pathname + (s ? `?${s}` : '') + window.location.hash);
  }

  if (sv && !isValidDomain(sv)) {
    localStorage.removeItem(K);
    sv = null;
  }
  if (sv && !paramProcessed && sv !== 'debug') {
    splog(`🔌 Stagepass connected to: ${sv}`);
  }
  const dev = !!sv;
  const swap = !!sv && sv !== 'debug';
  const dom = swap ? clean(sv) : null;
  const now = swap ? Date.now() : 0;
  const cacheBust = now;
  const sessionStartTime = now;

  const hostname = window.location.hostname;
  const isLocalhost = hostname === 'localhost' || hostname === '127.0.0.1' || hostname.startsWith('localhost:') || hostname.startsWith('127.0.0.1:');
  const isLocal = swap || isLocalhost;
  const env: 'local' | 'staging' | 'production' = isLocal ? 'local' : (hostname.endsWith('.webflow.io') ? 'staging' : 'production');

  const hasValidSession = sv && isValidDomain(sv);
  const shouldSuppress = !hasValidSession && !p.has(P);
  if (shouldSuppress && (env === 'production' || (env === 'staging' && silentParam !== null))) {
    const noop = () => {};
    console.log = console.warn = console.error = console.info = console.debug = noop;
  }

  const stagepassObj = (window as any).stagepass || {};
  stagepassObj.vars = Object.freeze({
    isLocal,
    env,
    domain: dom || hostname,
    timestamp: sessionStartTime,
    version: '1.1.0'
  });
  (window as any).stagepass = stagepassObj;
  // Also expose as global variable (without window prefix)
  (globalThis as any).stagepass = stagepassObj;

  function swapEl(sel: string, pathAttr: string, srcAttr: string, type: 'script' | 'link', skipAttrs: string[]) {
    document.querySelectorAll(`${sel}:not([data-stagepass-processed])`).forEach((el: any) => {
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
      const url = swap && lp && dom ? `https://${dom}/${lp.startsWith('/') ? lp.substring(1) : lp}?_cb=${cacheBust}` : ps;
      if (!url) return;
      const n = document.createElement(type);
      if (type === 'script') {
        (n as HTMLScriptElement).src = url;
        Array.from(el.attributes).forEach((a) => {
          const attr = a as Attr;
          if (!skipAttrs.includes(attr.name)) n.setAttribute(attr.name, attr.value);
        });
        if (!el.hasAttribute('async') && !el.hasAttribute('defer')) n.setAttribute('defer', '');
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
        sperror(`${type} injection failed: No parent node`);
      }
    });
  }

  function loadModules() {
    // If no modules parameter in script tag, don't load anything
    if (modulesParam === null) return;

    // If modules param exists but is empty (just ?modules), load 'all'
    const modulesToLoad = modulesParam === ''
      ? ['all']
      : modulesParam.split(',').map(m => m.trim()).filter(Boolean);
    
    if (modulesToLoad.length === 0) return;

    // Determine base URL from loader script (CDN or local)
    // Remove query string and filename to get base directory
    let baseUrl = window.location.origin;
    if (loaderScript && loaderScript.src) {
      try {
        const scriptUrl = new URL(loaderScript.src);
        // Remove filename and query string to get base directory
        const pathParts = scriptUrl.pathname.split('/');
        pathParts.pop(); // Remove filename
        baseUrl = `${scriptUrl.origin}${pathParts.join('/')}`;
      } catch (e) {
        // Fallback: simple string replacement
        baseUrl = loaderScript.src.replace(/\/[^\/\?]+(\?.*)?$/, '');
      }
    }

    modulesToLoad.forEach(moduleName => {
      const moduleUrl = `${baseUrl}/${moduleName}.min.js`;
      const script = document.createElement('script');
      script.src = moduleUrl;
      script.async = true;
      document.head.appendChild(script);
      
      if (env !== 'production') {
        splog(`📦 Loading module: ${moduleName}`);
      }
    });
  }

  const process = () => {
    swapEl('script[data-stagepass]', 'data-stagepass-path', 'data-src', 'script', ['data-src', 'data-stagepass', 'data-stagepass-path']);
    swapEl('link[rel="stylesheet"][data-stagepass]', 'data-stagepass-path', 'data-href', 'link', ['href', 'data-href', 'data-stagepass', 'data-stagepass-path']);
  };

  loadModules();
  process();
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', process);
  }

  function flag() {
    if (!dev) return;
    const f = document.createElement('div');
    f.id = 'stagepass-flag';
    f.textContent = sv === 'debug' ? 'STAGEPASS DEBUG' : 'STAGEPASS ACTIVE';
    f.style.cssText = 'font:12px/1 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;font-weight:bold;color:#fff;background:#D92662;padding:4px 6px;z-index:9999999999;position:fixed;top:0;right:0;cursor:pointer;border-radius:0 0 0 4px;user-select:none;';
    f.addEventListener('click', () => {
      localStorage.removeItem(K);
      splog('🔌 Stagepass disconnected.');
      window.location.reload();
    });
    if (document.body) {
      document.body.appendChild(f);
    } else {
      document.addEventListener('DOMContentLoaded', () => {
        if (document.body) document.body.appendChild(f);
      });
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', flag);
  } else {
    flag();
  }
})();