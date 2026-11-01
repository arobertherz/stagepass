/**
 * Client-side maintenance overlay module.
 *
 * This is NOT access protection: page HTML remains in the document.
 * SEO / noindex must be handled by the site itself (this module does not inject robots meta).
 */
(function () {
  const OVERLAY_ID = 'stagepass-maintenance-overlay';
  const BADGE_ID = 'stagepass-maintenance-badge';
  const STYLE_ID = 'stagepass-maintenance-style';

  const DEFAULT_TITLE = 'We will be back soon';
  const DEFAULT_TEXT = 'This site is temporarily unavailable while we perform maintenance.';

  function getStagepassObject() {
    const sp =
      (window as any).stagepass ||
      (globalThis as any).stagepass ||
      (window as any).sp ||
      (globalThis as any).sp;
    if (!sp || !sp.vars) {
      try {
        console.warn(
          '[Stagepass] Core loader must be loaded before the maintenance module. Skipping registration.'
        );
      } catch (_) {}
      return null;
    }
    return sp;
  }

  function getModuleScript() {
    try {
      if (document.currentScript instanceof HTMLScriptElement) {
        return document.currentScript;
      }
    } catch (_) {}
    try {
      const scripts = document.querySelectorAll('script[src*="maintenance"]');
      for (let i = scripts.length - 1; i >= 0; i--) {
        const s = scripts[i] as HTMLScriptElement;
        if (/maintenance(?:\.min)?\.js/i.test(s.src || '')) return s;
      }
      // all.min.js may carry the attributes
      const allScripts = document.querySelectorAll('script[src*="all"]');
      for (let i = allScripts.length - 1; i >= 0; i--) {
        const s = allScripts[i] as HTMLScriptElement;
        if (/all(?:\.min)?\.js/i.test(s.src || '') && s.hasAttribute('data-stagepass-maintenance')) {
          return s;
        }
      }
    } catch (_) {}
    return null;
  }

  function hasDeveloperSession(sp) {
    try {
      if (typeof sp.is === 'function' && sp.is('local')) return true;
    } catch (_) {}
    try {
      const raw = localStorage.getItem('stagepass_domain');
      if (!raw) return false;
      if (raw.startsWith('{')) {
        const parsed = JSON.parse(raw);
        const domain = parsed && parsed.domain;
        if (domain === 'debug') return true;
        if (typeof domain === 'string' && domain.endsWith('.sp')) return true;
        if (domain === 'localhost' || (typeof domain === 'string' && domain.startsWith('localhost:'))) {
          return true;
        }
      }
    } catch (_) {}
    return false;
  }

  function ensureStyles() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
#${OVERLAY_ID}{position:fixed;inset:0;z-index:2147483646;display:flex;align-items:center;justify-content:center;padding:24px;box-sizing:border-box;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;background:#f4f4f5;color:#18181b}
#${OVERLAY_ID} .sp-m-card{max-width:32rem;width:100%;text-align:center}
#${OVERLAY_ID} .sp-m-title{margin:0 0 12px;font-size:1.75rem;line-height:1.2;font-weight:700}
#${OVERLAY_ID} .sp-m-text{margin:0;font-size:1rem;line-height:1.5;opacity:.85}
#${BADGE_ID}{position:fixed;left:0;bottom:0;z-index:2147483645;font:12px/1.2 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;font-weight:700;color:#fff;background:#b45309;padding:6px 8px;border-radius:0 4px 0 0;cursor:default;user-select:none}
@media (prefers-color-scheme:dark){
#${OVERLAY_ID}{background:#09090b;color:#fafafa}
#${BADGE_ID}{background:#d97706;color:#111}
}`;
    (document.head || document.documentElement).appendChild(style);
  }

  function removeEl(id) {
    const el = document.getElementById(id);
    if (el) el.remove();
  }

  function showOverlay(title, text) {
    ensureStyles();
    removeEl(OVERLAY_ID);
    removeEl(BADGE_ID);

    const overlay = document.createElement('div');
    overlay.id = OVERLAY_ID;
    overlay.setAttribute('role', 'alertdialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-labelledby', 'stagepass-maintenance-title');
    overlay.setAttribute('aria-describedby', 'stagepass-maintenance-desc');
    overlay.tabIndex = -1;

    const card = document.createElement('div');
    card.className = 'sp-m-card';

    const h = document.createElement('h1');
    h.id = 'stagepass-maintenance-title';
    h.className = 'sp-m-title';
    h.textContent = title;

    const p = document.createElement('p');
    p.id = 'stagepass-maintenance-desc';
    p.className = 'sp-m-text';
    p.textContent = text;

    card.appendChild(h);
    card.appendChild(p);
    overlay.appendChild(card);

    const mount = () => {
      (document.body || document.documentElement).appendChild(overlay);
      try {
        overlay.focus();
      } catch (_) {}
    };
    if (document.body) mount();
    else document.addEventListener('DOMContentLoaded', mount, { once: true });
  }

  function showDevBadge(title) {
    ensureStyles();
    removeEl(OVERLAY_ID);
    removeEl(BADGE_ID);

    const badge = document.createElement('div');
    badge.id = BADGE_ID;
    badge.setAttribute('role', 'status');
    badge.textContent = `Maintenance mode on (visitors see: ${title})`;

    const mount = () => {
      (document.body || document.documentElement).appendChild(badge);
    };
    if (document.body) mount();
    else document.addEventListener('DOMContentLoaded', mount, { once: true });
  }

  function register(sp) {
    let active = false;
    let title = DEFAULT_TITLE;
    let text = DEFAULT_TEXT;

    function enable(opts) {
      if (opts?.title) title = String(opts.title);
      if (opts?.text) text = String(opts.text);
      active = true;
      if (hasDeveloperSession(sp)) {
        showDevBadge(title);
      } else {
        showOverlay(title, text);
      }
    }

    function disable() {
      active = false;
      removeEl(OVERLAY_ID);
      removeEl(BADGE_ID);
    }

    function isActive() {
      return active;
    }

    sp.maintenance = { enable, disable, isActive };

    const script = getModuleScript();
    const attr = script?.getAttribute('data-stagepass-maintenance');
    if (attr === 'true') {
      const t = script?.getAttribute('data-stagepass-maintenance-title') || DEFAULT_TITLE;
      const body = script?.getAttribute('data-stagepass-maintenance-text') || DEFAULT_TEXT;
      enable({ title: t, text: body });
    }
  }

  const sp = getStagepassObject();
  if (!sp) return;

  const MODULE_VERSION = '2.0.0';
  if (typeof sp.use === 'function') {
    sp.use('maintenance', MODULE_VERSION, register);
  } else {
    register(sp);
  }

  (globalThis as any).stagepass = sp;
  (window as any).sp = sp;
  (globalThis as any).sp = sp;
})();
