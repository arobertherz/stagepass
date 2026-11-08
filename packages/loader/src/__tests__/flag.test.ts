import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createSession, serializeSession, SESSION_KEY } from '../session.js';

const FLAG = Symbol.for('stagepass.flag.v2');
const CARD = Symbol.for('stagepass.card.v2');
const NO_GLOW = /box-shadow|text-shadow|filter|drop-shadow|radial-gradient|blur\(/;

function startSession(domain: string) {
  localStorage.setItem(SESSION_KEY, serializeSession(createSession(domain)));
}

/** Run the loader IIFE (and optionally the lazy flag chunk) fresh. */
async function boot(withChunk = true) {
  vi.resetModules();
  await import('../index.js');
  if (withChunk) await import('../flag-entry.js');
}
const loadCard = () => import('../flag-card-entry.js');

function parts() {
  const host = document.getElementById('stagepass-flag');
  const root = host?.shadowRoot as ShadowRoot;
  const q = <T extends Element = HTMLElement>(s: string) => root?.querySelector(s) as T | null;
  return {
    host,
    root,
    q,
    w: q('.w')!,
    pill: q<HTMLButtonElement>('button.b')!,
    label: q('.t > b')?.textContent,
    counters: Array.from(root?.querySelectorAll('.c > span') || [], (s) => s.textContent),
    card: q('[role=dialog]'),
  };
}
function ptr(el: EventTarget, type: string, pointerType = 'mouse') {
  const e = new Event(type, { bubbles: type == 'pointerdown', composed: true });
  Object.defineProperty(e, 'pointerType', { value: pointerType });
  el.dispatchEvent(e);
}
function sheetCss(root: ShadowRoot & { adoptedStyleSheets?: CSSStyleSheet[] }) {
  const sheets = root.adoptedStyleSheets || [];
  return (
    sheets.map((s) => Array.from(s.cssRules, (r) => r.cssText).join('')).join('') +
    Array.from(root.querySelectorAll('style'), (s) => s.textContent).join('')
  );
}
/** Open the card (mouse: hover expands, click opens) with the card chunk loaded. */
async function openCard() {
  const { pill } = parts();
  ptr(pill, 'pointerenter');
  await loadCard();
  pill.click();
  return parts();
}

describe('dev flag v2', () => {
  let reload: ReturnType<typeof vi.fn>;
  let loc: Record<string, unknown>;

  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    document.head.innerHTML = '';
    document.body.innerHTML = '';
    delete (window as any).stagepass;
    delete (window as any).sp;
    reload = vi.fn();
    loc = { hostname: 'wlncw02.webflow.io', href: 'https://wlncw02.webflow.io/', search: '', pathname: '/', hash: '', reload };
    vi.stubGlobal('location', loc);
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('is absent without a session and no flag chunk is requested', async () => {
    await boot();
    expect(document.getElementById('stagepass-flag')).toBeNull();
    expect(document.querySelector('script[src*="flag"]')).toBeNull();
    expect((window as any).stagepass[FLAG]).toBeUndefined();
    expect((window as any).stagepass.vars.env).toBe('staging');
  });

  it('requests flag.min.js only during a session (pinned CDN path)', async () => {
    startSession('my-project.sp');
    await boot(false);
    const s = document.querySelector('script[src*="flag.min.js"]') as HTMLScriptElement;
    expect(s.src).toMatch(/^https:\/\/cdn\.jsdelivr\.net\/npm\/@stagepass\/loader@[^/]+\/dist\/flag\.min\.js$/);
    expect(s.async).toBe(true);
    expect(document.querySelector('script[src*="flag-card"]')).toBeNull();
  });

  it('loads both flag chunks next to the loader when the loader src is known', async () => {
    startSession('my-project.sp');
    const loader = document.createElement('script');
    loader.src = 'https://cdn.jsdelivr.net/npm/@stagepass/loader@2/dist/loader.min.js?modules=cookies';
    document.head.appendChild(loader);
    await boot();
    expect((document.querySelector('script[src*="flag.min.js"]') as HTMLScriptElement).src).toBe(
      'https://cdn.jsdelivr.net/npm/@stagepass/loader@2/dist/flag.min.js'
    );
    ptr(parts().pill, 'pointerenter');
    expect((document.querySelector('script[src*="flag-card"]') as HTMLScriptElement).src).toBe(
      'https://cdn.jsdelivr.net/npm/@stagepass/loader@2/dist/flag-card.min.js'
    );
  });

  describe('flag chunk location (relative to the loader URL)', () => {
    const flagSrc = () => (document.querySelector('script[src*="flag.min.js"]') as HTMLScriptElement | null)?.src;
    /** Boot with `el` as document.currentScript (how a real browser runs the loader tag). */
    async function bootAs(el: HTMLScriptElement) {
      document.head.appendChild(el);
      const desc = Object.getOwnPropertyDescriptor(Document.prototype, 'currentScript');
      Object.defineProperty(document, 'currentScript', { configurable: true, get: () => el });
      try {
        await boot(false);
      } finally {
        delete (document as any).currentScript;
        if (!desc) delete (document as any).currentScript;
      }
    }
    const tag = (src?: string, attrs: Record<string, string> = {}) => {
      const s = document.createElement('script');
      if (src) s.src = src;
      for (const [k, v] of Object.entries(attrs)) s.setAttribute(k, v);
      return s;
    };
    afterEach(() => {
      delete (window as any).stagepassFlagBase;
    });

    it('CDN @2: unchanged, next to the loader', async () => {
      startSession('my-project.sp');
      await bootAs(tag('https://cdn.jsdelivr.net/npm/@stagepass/loader@2/dist/loader.min.js?modules=cookies'));
      expect(flagSrc()).toBe('https://cdn.jsdelivr.net/npm/@stagepass/loader@2/dist/flag.min.js');
    });

    it('self-hosted under another file name: same folder, no jsDelivr', async () => {
      startSession('my-project.sp');
      await bootAs(tag('https://www.example.com/js/stagepass-2.3.1.js?v=3#x'));
      expect(flagSrc()).toBe('https://www.example.com/js/flag.min.js');
      await import('../flag-entry.js');
      ptr(parts().pill, 'pointerenter');
      expect((document.querySelector('script[src*="flag-card"]') as HTMLScriptElement).src).toBe(
        'https://www.example.com/js/flag-card.min.js'
      );
      expect(document.querySelector('script[src*="jsdelivr"]')).toBeNull();
    });

    it('subfolder (npm install copied to /vendor/…): same folder, relative src resolved', async () => {
      startSession('my-project.sp');
      await bootAs(tag('/vendor/@stagepass/loader/dist/loader.min.js'));
      expect(flagSrc()).toBe(new URL('/vendor/@stagepass/loader/dist/flag.min.js', document.baseURI).href);
    });

    it('option data-stagepass-flag-base wins (relative or absolute folder)', async () => {
      startSession('my-project.sp');
      await bootAs(tag('https://www.example.com/js/app.bundle.js', { 'data-stagepass-flag-base': '/static/stagepass' }));
      expect(flagSrc()).toBe(new URL('/static/stagepass/flag.min.js', document.baseURI).href);
    });

    it('option as window.stagepassFlagBase (bundled as a module, no script tag)', async () => {
      startSession('my-project.sp');
      (window as any).stagepassFlagBase = 'https://assets.example.com/sp/';
      await boot(false);
      expect(flagSrc()).toBe('https://assets.example.com/sp/flag.min.js');
    });

    for (const bad of ['javascript:alert(1)//', 'data:text/javascript,alert(1)//', 'blob:https://x.test/1', 'https://u:p@evil.test/', ' ']) {
      it(`refuses an unsafe option ${JSON.stringify(bad)} and keeps the loader folder`, async () => {
        startSession('my-project.sp');
        await bootAs(tag('https://www.example.com/js/loader.min.js', { 'data-stagepass-flag-base': bad }));
        expect(flagSrc()).toBe('https://www.example.com/js/flag.min.js');
        expect(document.querySelector('script[src^="javascript:"], script[src^="data:"], script[src^="blob:"]')).toBeNull();
      });
    }

    it('inline (no script URL, no option): jsDelivr at the same version, reported in debug mode', async () => {
      startSession('debug');
      const warn = console.warn as unknown as ReturnType<typeof vi.fn>;
      await bootAs(tag());
      expect(flagSrc()).toMatch(/^https:\/\/cdn\.jsdelivr\.net\/npm\/@stagepass\/loader@[^/]+\/dist\/flag\.min\.js$/);
      expect(warn.mock.calls.flat().join(' ')).toMatch(/Loader URL unknown/);
    });

    it('inline outside debug mode: same fallback, no extra message', async () => {
      startSession('my-project.sp');
      const warn = console.warn as unknown as ReturnType<typeof vi.fn>;
      await bootAs(tag());
      expect(flagSrc()).toMatch(/^https:\/\/cdn\.jsdelivr\.net\/npm\/@stagepass\/loader@[^/]+\/dist\/flag\.min\.js$/);
      expect(warn.mock.calls.flat().join(' ')).not.toMatch(/Loader URL unknown/);
    });
  });

  it('without a session touches no flag DOM, styles, listeners, console, storage or requests', async () => {
    const warn = console.warn;
    const error = console.error;
    const wAdd = vi.spyOn(window, 'addEventListener');
    const dAdd = vi.spyOn(document, 'addEventListener');
    const create = vi.spyOn(document, 'createElement');
    const setItem = vi.spyOn(Storage.prototype, 'setItem');
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    await boot(false);
    expect(document.head.children.length + document.body.children.length).toBe(0);
    expect(create).not.toHaveBeenCalled();
    const types = [...wAdd.mock.calls, ...dAdd.mock.calls].map((c) => c[0]);
    for (const t of ['error', 'unhandledrejection', 'keydown', 'pointerdown']) expect(types).not.toContain(t);
    expect(console.warn).toBe(warn);
    expect(console.error).toBe(error);
    // Only the capability probe of sp.client() (unchanged since 2.0), removed right away
    expect(setItem.mock.calls.map((c) => c[0]).filter((k) => k !== '__stagepass_test__')).toEqual([]);
    expect(localStorage.length + sessionStorage.length).toBe(0);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect((window as any).stagepass[FLAG]).toBeUndefined();
  });

  it('without a session the option is not read and nothing is requested', async () => {
    (window as any).stagepassFlagBase = 'https://assets.example.com/sp/';
    await boot(false);
    expect(document.querySelector('script')).toBeNull();
    expect(document.getElementById('stagepass-flag')).toBeNull();
    delete (window as any).stagepassFlagBase;
  });

  it('ignores the old beta hook (mismatched cached chunks stay silent)', async () => {
    startSession('my-project.sp');
    await boot(false);
    expect((window as any).stagepass[Symbol.for('stagepass.flag')]).toBeUndefined();
    expect(typeof (window as any).stagepass[FLAG]).toBe('function');
  });

  it('stage 1: only the pill, as a button with aria-expanded, in a closed-off shadow root', async () => {
    startSession('my-project.sp');
    await boot();
    const { host, pill, w, label, card } = parts();
    expect(host?.children.length).toBe(0);
    expect(w.dataset.st).toBe('rest');
    expect(label).toBe('LOCAL');
    expect(pill.type).toBe('button');
    expect(pill.getAttribute('aria-expanded')).toBe('false');
    expect(pill.getAttribute('aria-haspopup')).toBe('dialog');
    expect(pill.getAttribute('aria-label')).toBe('Stagepass LOCAL, 0 warnings, 0 errors. Show session details');
    expect(w.hasAttribute('data-d')).toBe(false);
    expect(card).toBeNull();
    expect((window as any).stagepass[FLAG]).toBeUndefined();
  });

  it('pill and card CSS: no glow, shadow, blur or filter in any state', async () => {
    startSession('my-project.sp');
    await boot();
    await openCard();
    const css = sheetCss(parts().root as any);
    expect(css).toMatch(/\.cd/);
    expect(css).not.toMatch(NO_GLOW);
    expect(css).not.toMatch(/button:{1,2}(before|after)/);
    expect(css).not.toMatch(/@keyframes/);
    // Ink label on the gradient (one token)
    expect(css).toMatch(/--fg:\s*#17171B/i);
    // The card never runs off short viewports: header and footer stay reachable
    expect(css).toMatch(/max-height:calc\(100vh - 68px\)/);
    expect(css).toMatch(/\.cd\[hidden\]/);
    expect(css).toMatch(/max-width:calc\(100vw - 24px\)/);
    // Only the inner content scrolls
    expect(css).toMatch(/\.sc\{flex:1 1 auto;min-height:0;overflow:auto;overscroll-behavior:contain\}/);
  });

  it('stage 2: hover and focus expand, leave and blur collapse', async () => {
    startSession('my-project.sp');
    await boot();
    const { pill, w } = parts();
    ptr(pill, 'pointerenter');
    expect(w.dataset.st).toBe('exp');
    ptr(w, 'pointerleave');
    expect(w.dataset.st).toBe('rest');
    pill.dispatchEvent(new FocusEvent('focus'));
    expect(w.dataset.st).toBe('exp');
    pill.dispatchEvent(new FocusEvent('blur'));
    expect(w.dataset.st).toBe('rest');
  });

  it('dot and counters: warning triangle, error octagon, errors win, 99+', async () => {
    startSession('my-project.sp');
    await boot();
    const sp = (window as any).sp;
    sp.warn('careful');
    sp.log('warn', 'via log');
    expect(parts().w.dataset.d).toBe('w');
    expect(parts().counters).toEqual(['2']);
    sp.error('boom');
    let p = parts();
    expect(p.w.dataset.d).toBe('e');
    expect(p.counters).toEqual(['2', '1']);
    expect(p.q('.c > span:last-child path')?.getAttribute('d')).toMatch(/^M4 1h4l3 3/);
    expect(p.pill.getAttribute('aria-label')).toContain('2 warnings, 1 error.');
    for (let i = 0; i < 120; i++) sp.error('x');
    expect(parts().counters).toEqual(['2', '99+']);
  });

  it('DEBUG label for debug sessions and never a LIVE state', async () => {
    startSession('debug');
    await boot();
    expect(parts().label).toBe('DEBUG');
    expect(parts().root.textContent).not.toMatch(/LIVE/);
  });

  it('stage 3: click opens the card dialog and moves focus into it', async () => {
    startSession('my-project.sp');
    await boot();
    const { pill, w, card, q } = await openCard();
    expect(w.dataset.st).toBe('card');
    expect(pill.getAttribute('aria-expanded')).toBe('true');
    expect(card?.getAttribute('aria-label')).toBe('Stagepass session');
    expect(card?.hidden).toBe(false);
    expect(parts().root.activeElement).toBe(card);
    expect(q('.r1 strong')?.textContent).toBe('my-project');
    expect(q('.dm')?.textContent).toBe('my-project.sp');
    expect(q<HTMLButtonElement>('.ds')?.hidden).toBe(true);
    expect(q('.em')?.textContent).toBe('No warnings or errors in this session.');
    const labels = Array.from(card!.querySelectorAll('.ft button'), (b) => b.textContent);
    expect(labels).toEqual(['Reload', 'Debug mode', 'End session']);
    expect(pill.getAttribute('aria-label')).toContain('Hide session details');
  });

  it('Esc closes the card back to stage 2 and returns focus to the pill', async () => {
    startSession('my-project.sp');
    await boot();
    const { pill, w } = await openCard();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(w.dataset.st).toBe('exp');
    expect(parts().root.activeElement).toBe(pill);
    expect(pill.getAttribute('aria-expanded')).toBe('false');
    expect(localStorage.getItem(SESSION_KEY)).not.toBeNull();
  });

  it('outside click closes everything, clicking the pill again goes back to stage 2', async () => {
    startSession('my-project.sp');
    await boot();
    let { pill, w } = await openCard();
    pill.click();
    expect(w.dataset.st).toBe('exp');
    pill.click();
    expect(w.dataset.st).toBe('card');
    ptr(document.body, 'pointerdown');
    expect(w.dataset.st).toBe('rest');
    expect(localStorage.getItem(SESSION_KEY)).not.toBeNull();
    expect(reload).not.toHaveBeenCalled();
    // Focus goes back to the pill (quietly: it stays at rest)
    await new Promise((r) => setTimeout(r, 0));
    expect(parts().root.activeElement).toBe(pill);
    expect(w.dataset.st).toBe('rest');
  });

  it('outside click on a focusable page element leaves focus there', async () => {
    startSession('my-project.sp');
    await boot();
    const input = document.body.appendChild(document.createElement('input'));
    const { w } = await openCard();
    ptr(input, 'pointerdown');
    input.focus();
    await new Promise((r) => setTimeout(r, 0));
    expect(document.activeElement).toBe(input);
    expect(w.dataset.st).toBe('rest');
  });

  it('touch: first tap expands, second tap opens the card', async () => {
    startSession('my-project.sp');
    await boot();
    await loadCard();
    const { pill, w } = parts();
    ptr(pill, 'pointerdown', 'touch');
    pill.dispatchEvent(new FocusEvent('focus'));
    pill.click();
    expect(w.dataset.st).toBe('exp');
    ptr(pill, 'pointerdown', 'touch');
    pill.click();
    expect(w.dataset.st).toBe('card');
  });

  it('only End session disconnects', async () => {
    startSession('my-project.sp');
    await boot();
    const events: unknown[] = [];
    (window as any).sp.on('session', (p: unknown) => events.push(p));
    const { pill, card } = await openCard();
    pill.click();
    pill.click();
    expect(localStorage.getItem(SESSION_KEY)).not.toBeNull();
    const [rl, , end] = Array.from(card!.querySelectorAll<HTMLButtonElement>('.ft button'));
    rl.click();
    expect(reload).toHaveBeenCalledTimes(1);
    expect(localStorage.getItem(SESSION_KEY)).not.toBeNull();
    end.click();
    expect(localStorage.getItem(SESSION_KEY)).toBeNull();
    expect(events).toEqual([{ active: false, domain: null, swap: false, debug: false }]);
    expect(reload).toHaveBeenCalledTimes(2);
  });

  it('keeps the last 50 messages, truncates long ones and counts all', async () => {
    startSession('my-project.sp');
    await boot();
    const sp = (window as any).sp;
    sp.warn('x'.repeat(2000));
    for (let i = 0; i < 59; i++) sp.warn('w' + i);
    expect(sp.vars).toBeTruthy();
    const { card, q } = await openCard();
    expect(card!.querySelectorAll('.it').length).toBe(50);
    expect(card!.querySelector('.it .tx')?.textContent).toBe('Warning: w58');
    expect(q('.lh .ct')?.textContent).toBe('60 total, latest 50 shown');
    expect(parts().counters).toEqual(['60']);
    const s2 = 'y'.repeat(2000);
    sp.warn(s2);
    const t = card!.querySelector('.it .tx')!.textContent!;
    expect(t.length).toBe('Warning: '.length + 501);
    expect(t.endsWith('…')).toBe(true);
  });

  it('counts warnings that happen before the chunks have loaded', async () => {
    startSession('my-project.sp');
    await boot(false);
    (window as any).sp.warn('early');
    await import('../flag-entry.js');
    expect(parts().counters).toEqual(['1']);
    expect((window as any).stagepass[CARD]).toBeUndefined();
  });

  it('does not count when no session is active', async () => {
    await boot();
    (window as any).sp.warn('ignored');
    window.dispatchEvent(new Event('error'));
    expect(document.getElementById('stagepass-flag')).toBeNull();
  });

  it('warns once per local path when two non-explicit swaps collide', async () => {
    startSession('my-project.sp');
    const warn = console.warn as unknown as ReturnType<typeof vi.fn>;
    document.body.innerHTML =
      '<script data-stagepass data-src="https://cdn.example.com/a/main.js"></script>' +
      '<script data-stagepass data-src="https://cdn.example.com/b/main.js"></script>';
    // Core tracks files; dup warning runs in the flag chunk
    await boot(false);
    expect(warn.mock.calls.flat().join(' ')).not.toMatch(/Multiple assets resolve to local file/);
    await import('../flag-entry.js');
    expect(warn.mock.calls.flat().join(' ')).toMatch(/Multiple assets resolve to local file "main\.js"/);
  });

  it('does not warn when colliding paths use data-stagepass-path', async () => {
    startSession('my-project.sp');
    const warn = console.warn as unknown as ReturnType<typeof vi.fn>;
    document.body.innerHTML =
      '<script data-stagepass data-stagepass-path="a/main.js" data-src="https://cdn.example.com/a/main.js"></script>' +
      '<script data-stagepass data-stagepass-path="b/main.js" data-src="https://cdn.example.com/b/main.js"></script>';
    await boot(true);
    expect(warn.mock.calls.flat().join(' ')).not.toMatch(/Multiple assets resolve to local file/);
  });
});
