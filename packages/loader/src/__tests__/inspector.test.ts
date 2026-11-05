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

describe('dev flag inspector', () => {
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
  it('swapped files: crossorigin in swap mode, counted only after load, collapsed list with status', async () => {
    startSession('my-project.sp');
    document.body.innerHTML =
      '<script data-stagepass data-src="https://cdn.example.com/a/b/main.js"></script>' +
      '<link rel="stylesheet" data-stagepass data-href="https://cdn.example.com/a/styles.css">';
    await boot();
    await new Promise((r) => setTimeout(r, 0));
    const sc = document.querySelector('script[src^="https://my-project.sp/"]') as HTMLScriptElement;
    const ln = document.querySelector('link[href^="https://my-project.sp/"]') as HTMLLinkElement;
    expect(sc.crossOrigin).toBe('anonymous');
    expect(ln.crossOrigin).toBe('anonymous');
    const { q, root } = await openCard();
    const ds = q<HTMLButtonElement>('.ds')!;
    expect(ds.textContent).toBe('0 files swapped locally');
    sc.dispatchEvent(new Event('load'));
    expect(ds.textContent).toBe('1 file swapped locally');
    expect(ds.getAttribute('aria-expanded')).toBe('false');
    expect(q('.fl')!.hidden).toBe(true);
    ds.click();
    expect(ds.getAttribute('aria-expanded')).toBe('true');
    const rows = Array.from(root.querySelectorAll('.fl li'), (li) => li.textContent);
    expect(rows).toEqual(['js/main.jsoklive cdn.example.com/…/b/main.js', 'css/styles.cssloadinglive cdn.example.com/a/styles.css']);
    expect((root.querySelector('.fl li') as HTMLElement).title).toMatch(/^https:\/\/cdn\.example\.com\/a\/b\/main\.js\n→ https:\/\/my-project\.sp\/main\.js\?_cb=\d+$/);
  });

  it('swapped files: 404 vs unreachable server, LNA hint only on a network failure', async () => {
    startSession('my-project.sp');
    document.body.innerHTML =
      '<script data-stagepass data-src="https://cdn.example.com/a/main.js"></script>' +
      '<script data-stagepass data-src="https://cdn.example.com/a/other.js"></script>';
    const fetch = vi.fn((u: string, _o: any) =>
      u.includes('main.js') ? Promise.resolve({ ok: false, status: 404 }) : Promise.reject(new TypeError('Failed to fetch'))
    );
    vi.stubGlobal('fetch', fetch);
    await boot();
    await new Promise((r) => setTimeout(r, 0));
    const [a, b] = Array.from(document.querySelectorAll<HTMLScriptElement>('script[src^="https://my-project.sp/"]'));
    a.dispatchEvent(new Event('error'));
    b.dispatchEvent(new Event('error'));
    await new Promise((r) => setTimeout(r, 0));
    expect(fetch.mock.calls[0][1]).toMatchObject({ method: 'HEAD' });
    const { card, q, root } = await openCard();
    const tx = Array.from(card!.querySelectorAll('.tx'), (t) => t.textContent);
    expect(tx).toEqual(['Error: Local server not reachable: other.js. Run stagepass doctor', 'Error: Local file not found (404): main.js']);
    expect(q('.ds')!.textContent).toBe('0 files swapped locally · 2 failed');
    q<HTMLButtonElement>('.ds')!.click();
    expect(Array.from(root.querySelectorAll('.fl .bad'), (x) => x.textContent)).toEqual(['404', 'failed']);
  });

  it('LNA hint: no boot warning, only on a network-level failure of a swapped file', async () => {
    startSession('my-project.sp');
    document.body.innerHTML = '<script data-stagepass data-src="https://cdn.example.com/a/main.js"></script>';
    vi.stubGlobal('navigator', { ...navigator, permissions: { query: () => Promise.resolve({ state: 'prompt' }) } });
    vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new TypeError('Failed to fetch'))));
    await boot();
    await new Promise((r) => setTimeout(r, 0));
    let { card } = await openCard();
    expect(card!.querySelector('.it')).toBeNull();
    document.querySelector('script[src^="https://my-project.sp/"]')!.dispatchEvent(new Event('error'));
    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => setTimeout(r, 0));
    expect(card!.querySelector('.tx')?.textContent).toMatch(/^Error: Local server not reachable: main\.js\. Run stagepass doctor\. .*Local network access/i);
  });

  it('no CORS header on the local server: loads again without crossorigin and says so', async () => {
    startSession('my-project.sp');
    document.body.innerHTML = '<script data-stagepass data-src="https://cdn.example.com/a/main.js"></script>';
    vi.stubGlobal('fetch', vi.fn((_u: string, o: any) => (o.mode == 'no-cors' ? Promise.resolve({}) : Promise.reject(new TypeError('cors')))));
    await boot();
    await new Promise((r) => setTimeout(r, 0));
    document.querySelector('script[src^="https://my-project.sp/"]')!.dispatchEvent(new Event('error'));
    await new Promise((r) => setTimeout(r, 0));
    const again = document.querySelectorAll<HTMLScriptElement>('script[src^="https://my-project.sp/"]');
    expect(again.length).toBe(1);
    expect(again[0].hasAttribute('crossorigin')).toBe(false);
    const { card } = await openCard();
    expect(card!.querySelector('.tx')?.textContent).toMatch(/^Warning: Local server sends no CORS header for main\.js/);
    again[0].dispatchEvent(new Event('load'));
    expect(card!.querySelector('.ds')?.textContent).toBe('1 file swapped locally');
  });

  it('debug sessions keep production elements without crossorigin', async () => {
    startSession('debug');
    document.body.innerHTML = '<script data-stagepass data-src="https://cdn.example.com/a/main.js"></script>';
    await boot();
    await new Promise((r) => setTimeout(r, 0));
    const sc = document.querySelector('script[src="https://cdn.example.com/a/main.js"]')!;
    expect(sc.hasAttribute('crossorigin')).toBe(false);
  });

  it('no session: console is not wrapped and no crossorigin is added', async () => {
    const before = console.error;
    document.body.innerHTML = '<script data-stagepass data-src="https://cdn.example.com/a/main.js"></script>';
    await boot();
    await new Promise((r) => setTimeout(r, 0));
    expect(console.error).toBe(before);
    expect(document.querySelector('script[src="https://cdn.example.com/a/main.js"]')!.hasAttribute('crossorigin')).toBe(false);
  });

  it('Debug toggle: to debug and back, also from a new tab (restored session, no URL param)', async () => {
    startSession('my-project.sp');
    await boot();
    let db = (await openCard()).card!.querySelectorAll<HTMLButtonElement>('.ft button')[1];
    expect(db.textContent).toBe('Debug mode');
    expect(db.disabled).toBe(false);
    db.click();
    expect(loc.href).toBe('https://wlncw02.webflow.io/?stagepass=debug');
    expect(localStorage.getItem('stagepass:prev')).toBe('my-project.sp');
    expect(sessionStorage.getItem('stagepass:flash')).toBe('1');

    // New tab: sessionStorage is empty, the debug session comes from localStorage
    sessionStorage.clear();
    loc.href = 'https://wlncw02.webflow.io/';
    startSession('debug');
    document.body.innerHTML = '';
    await boot();
    const c = (await openCard()).card!;
    db = c.querySelectorAll<HTMLButtonElement>('.ft button')[1];
    expect(db.textContent).toBe('Back to local');
    expect(db.disabled).toBe(false);
    expect(c.querySelector('.hn')?.textContent).toBe('Live files with console logs. Back to local loads my-project.sp.');
    db.click();
    expect(loc.href).toBe('https://wlncw02.webflow.io/?stagepass=my-project.sp');
  });

  it('after a Debug toggle the pill expands once to show the new mode', async () => {
    startSession('debug');
    sessionStorage.setItem('stagepass:flash', '1');
    await boot();
    expect(parts().w.dataset.st).toBe('exp');
    expect(parts().label).toBe('DEBUG');
    expect(sessionStorage.getItem('stagepass:flash')).toBeNull();
  });

  it('Debug toggle is visibly disabled with a reason when there is no session to return to', async () => {
    startSession('debug');
    localStorage.setItem('stagepass:prev', 'javascript:alert(1)');
    await boot();
    const c = (await openCard()).card!;
    const db = c.querySelectorAll<HTMLButtonElement>('.ft button')[1];
    expect(db.disabled).toBe(true);
    expect(db.title).toBe('No local session to return to');
    expect(c.querySelector('.hn')?.textContent).toMatch(/No local session to return to: open the page with \?stagepass=<project>\.sp/);
  });

  it('Debug toggle keeps its nodes across renders', async () => {
    startSession('my-project.sp');
    await boot();
    const db = (await openCard()).card!.querySelectorAll<HTMLButtonElement>('.ft button')[1];
    const node = db.firstChild;
    (window as any).sp.warn('a');
    (window as any).sp.warn('b');
    expect(db.firstChild).toBe(node);
  });

  it('message list: newest first, one-liners, details on demand, text only (never HTML)', async () => {
    startSession('my-project.sp');
    await boot();
    const sp = (window as any).sp;
    sp.warn('first <img src=x onerror=alert(1)>');
    sp.error('second', { a: 1, b: [1, 'x'], c: { d: { e: { f: 1 } } } });
    const { card, q } = await openCard();
    const items = Array.from(card!.querySelectorAll<HTMLButtonElement>('.it'));
    expect(items.length).toBe(2);
    expect(items[0].className).toContain('e');
    expect(items[0].querySelector('.tx')?.textContent).toBe('Error: second {a: 1, b: [1, "x"], c: {d: {e: {…}}}}');
    expect(items[1].querySelector('.tx')?.textContent).toBe('Warning: first <img src=x onerror=alert(1)>');
    expect(card!.querySelector('img')).toBeNull();
    expect(items[0].querySelector('.mt')?.textContent).toMatch(/^\d\d:\d\d:\d\d$/);
    expect(q('.lh .ct')?.textContent).toBe('1 error · 1 warning');
    const dt = items[0].nextElementSibling as HTMLElement;
    expect(items[0].getAttribute('aria-expanded')).toBe('false');
    expect(dt.hidden).toBe(true);
    items[0].click();
    expect(items[0].getAttribute('aria-expanded')).toBe('true');
    expect(dt.hidden).toBe(false);
    expect(dt.querySelector('.lo')?.textContent).toMatch(/^(local|live) · .+:\d+:\d+$/);
  });

  it('"Always expanded" keeps details open, persisted per origin', async () => {
    startSession('my-project.sp');
    await boot();
    (window as any).sp.error(new TypeError('x is not a function'));
    let { card, q } = await openCard();
    const ax = Array.from(card!.querySelectorAll<HTMLButtonElement>('.lh button')).find((b) => b.textContent == 'Always expanded')!;
    expect(ax.getAttribute('aria-pressed')).toBe('false');
    ax.click();
    expect(localStorage.getItem('stagepass:expand')).toBe('1');
    expect(q('.it')?.getAttribute('aria-expanded')).toBe('true');
    expect(q('.dt pre')?.textContent).toMatch(/TypeError: x is not a function/);
    document.body.innerHTML = '';
    await boot();
    (window as any).sp.warn('again');
    ({ card, q } = await openCard());
    expect(q('.it')?.getAttribute('aria-expanded')).toBe('true');
  });

  it('groups repeats with a count and the last time', async () => {
    startSession('my-project.sp');
    await boot();
    const boom = () => window.dispatchEvent(new ErrorEvent('error', { message: 'boom', filename: 'https://x.test/app.js', lineno: 3, colno: 7 }));
    boom();
    boom();
    boom();
    (window as any).sp.warn('other');
    const { card, q } = await openCard();
    const items = Array.from(card!.querySelectorAll('.it'));
    expect(items.length).toBe(2);
    // F-5: ×N and the time must be separated by a space for screen readers and tests.
    expect(items[1].querySelector('.mt')?.textContent).toMatch(/^×3 \d\d:\d\d:\d\d$/);
    expect(q('.lh .ct')?.textContent).toBe('3 errors · 1 warning');
    boom();
    expect(card!.querySelector('.it .tx')?.textContent).toBe('Error: boom');
    expect(card!.querySelector('.it .mt b')?.textContent).toBe('×4');
    expect(card!.querySelector('.it .mt')?.textContent).toMatch(/^×4 \d\d:\d\d:\d\d$/);
  });

  it('message meta keeps a space between ×N and the time (F-5, AC-7)', async () => {
    startSession('my-project.sp');
    await boot();
    const boom = () =>
      window.dispatchEvent(
        new ErrorEvent('error', { message: 'space', filename: 'https://x.test/a.js', lineno: 1, colno: 1 })
      );
    boom();
    boom();
    const { card } = await openCard();
    const mt = card!.querySelector('.it .mt')!;
    expect(mt.querySelector('b')?.textContent).toBe('×2');
    expect(mt.textContent).toMatch(/^×2 \d\d:\d\d:\d\d$/);
    expect(mt.textContent).not.toMatch(/×\d\d:/); // no digit of the count glued to HH
  });

  it('captures console.warn/error (original still runs), errors with stack, no recursion', async () => {
    startSession('my-project.sp');
    const origErr = vi.fn();
    console.error = origErr;
    await boot();
    const e = new TypeError("Cannot read properties of undefined (reading 'x')");
    console.error('Boot failed:', e);
    expect(origErr).toHaveBeenCalledWith('Boot failed:', e);
    (window as any).sp.warn('own');
    const { card } = await openCard();
    const tx = Array.from(card!.querySelectorAll('.tx'), (t) => t.textContent);
    expect(tx).toEqual(['Warning: own', "Error: Boot failed: TypeError: Cannot read properties of undefined (reading 'x')"]);
    expect(parts().counters).toEqual(['1', '1']);
    card!.querySelectorAll<HTMLButtonElement>('.it')[1].click();
    expect(card!.querySelectorAll('.dt')[1].querySelector('pre')?.textContent).toBe(e.stack);
  });

  it('a throwing getter, a cycle or a DOM node never breaks console.error', async () => {
    startSession('my-project.sp');
    await boot();
    const cyc: any = { a: 1 };
    cyc.self = cyc;
    const bad = {
      get x() {
        throw new Error('no');
      },
    };
    expect(() => console.error(cyc, bad, document.body)).not.toThrow();
    const { card } = await openCard();
    expect(card!.querySelector('.tx')?.textContent).toBe('Error: {a: 1, self: {a: 1, self: {a: 1, self: {…}}}} [unserializable] <body>');
  });

  it('captures script errors with location and stack, failed loads, rejections and sanitized cross-origin errors', async () => {
    startSession('my-project.sp');
    await boot();
    const er = new Error('boom');
    window.dispatchEvent(new ErrorEvent('error', { message: 'boom', filename: 'https://my-project.sp/dist/app.js?t=1', lineno: 42, colno: 9, error: er }));
    window.dispatchEvent(new ErrorEvent('error', { message: 'Script error.', filename: '', lineno: 0 }));
    const img = document.createElement('img');
    img.src = 'https://cdn.example.com/a.png?x=1';
    document.body.appendChild(img);
    img.dispatchEvent(new Event('error'));
    const rej = new Event('unhandledrejection');
    Object.defineProperty(rej, 'reason', { value: new Error('nope') });
    window.dispatchEvent(rej);
    const { card } = await openCard();
    const tx = Array.from(card!.querySelectorAll('.tx'), (t) => t.textContent);
    expect(tx).toEqual([
      'Error: Unhandled rejection: Error: nope',
      'Error: Failed to load https://cdn.example.com/a.png',
      'Error: Error in a cross-origin script (details only in DevTools console)',
      'Error: boom',
    ]);
    const dts = card!.querySelectorAll('.dt');
    expect(dts[3].querySelector('.lo')?.textContent).toBe('local · https://my-project.sp/dist/app.js:42:9');
    expect(dts[2].querySelector('.lo')?.textContent).toBe('external');
    expect(dts[3].querySelector('pre')?.textContent).toBe(er.stack);
    expect(dts[0].querySelector('pre')?.textContent).toMatch(/Error: nope/);
    expect(parts().counters).toEqual(['4']);
  });

  it('Copy all and per-entry Copy: Markdown with page (no query), project, version, entries; no storage', async () => {
    startSession('my-project.sp');
    loc.origin = 'https://wlncw02.webflow.io';
    loc.pathname = '/de';
    loc.search = '?secret=1';
    localStorage.setItem('token', 'TOPSECRET');
    document.cookie = 'sid=COOKIESECRET';
    await boot();
    const writeText = vi.fn((_t: string) => Promise.resolve());
    vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText } });
    (window as any).sp.warn('first');
    const boom = () =>
      window.dispatchEvent(new ErrorEvent('error', { message: 'boom', filename: 'https://my-project.sp/dist/app.js', lineno: 4, colno: 2, error: new Error('boom') }));
    boom();
    boom();
    const { card, q } = await openCard();
    const ca = Array.from(card!.querySelectorAll<HTMLButtonElement>('.lh button')).find((b) => b.textContent == 'Copy all')!;
    ca.click();
    await Promise.resolve();
    await Promise.resolve();
    const out = writeText.mock.calls[0][0];
    expect(out).toMatch(/^### Stagepass messages\n- Page: https:\/\/wlncw02\.webflow\.io\/de\n- Project: my-project\.sp \(local files\)\n- Loader: @stagepass\/loader \S+\n/);
    expect(out).toContain('**2. Warning** (last ');
    expect(out).toContain('**1. Error ×2** (last ');
    expect(out).toContain('Location: local · https://my-project.sp/dist/app.js:4:2');
    expect(out).toContain('```\nError: boom');
    expect(out).not.toMatch(/secret|TOPSECRET|COOKIESECRET/i);
    expect(ca.textContent).toBe('Copied');
    expect(q('[aria-live]')?.textContent).toBe('Copied to clipboard');
    const it = card!.querySelector<HTMLButtonElement>('.it')!;
    it.click();
    (it.nextElementSibling as HTMLElement).querySelector<HTMLButtonElement>('button')!.click();
    await Promise.resolve();
    await Promise.resolve();
    const one = writeText.mock.calls[1][0];
    expect(one).toContain('**1. Error ×2**');
    expect(one).not.toContain('Warning');
  });
});
