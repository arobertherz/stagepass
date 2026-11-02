import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createSession, serializeSession, SESSION_KEY } from '../session.js';

const FLAG = Symbol.for('stagepass.flag.v2');
const CARD = Symbol.for('stagepass.card.v1');
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
    expect(css).toMatch(/\.cd\[hidden\]\{display:none\}/);
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
    expect(q('.sw')?.textContent).toBe('0 files swapped locally');
    expect(q('.em')?.textContent).toBe('No warnings or errors in this session.');
    const labels = Array.from(card!.querySelectorAll('.ft button'), (b) => b.textContent);
    expect(labels).toEqual(['Reload', 'Debug off', 'End session']);
    expect(pill.getAttribute('aria-label')).toContain('Hide session details');
  });

  it('counts locally swapped files', async () => {
    startSession('my-project.sp');
    document.body.innerHTML =
      '<script data-stagepass data-src="https://cdn.example.com/a/main.js"></script>' +
      '<link rel="stylesheet" data-stagepass data-href="https://cdn.example.com/a/styles.css">';
    await boot();
    await new Promise((r) => setTimeout(r, 0));
    const { q } = await openCard();
    expect(q('.sw')?.textContent).toBe('2 files swapped locally');
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

  it('Debug toggle reloads with ?stagepass=debug and back to the previous session', async () => {
    startSession('my-project.sp');
    await boot();
    let db = (await openCard()).card!.querySelectorAll<HTMLButtonElement>('.ft button')[1];
    expect(db.getAttribute('aria-pressed')).toBe('false');
    db.click();
    expect(loc.href).toBe('https://wlncw02.webflow.io/?stagepass=debug');
    expect(sessionStorage.getItem('stagepass:prev')).toBe('my-project.sp');

    loc.href = 'https://wlncw02.webflow.io/';
    startSession('debug');
    document.body.innerHTML = '';
    await boot();
    db = (await openCard()).card!.querySelectorAll<HTMLButtonElement>('.ft button')[1];
    expect(db.textContent).toBe('Debug on');
    expect(db.getAttribute('aria-pressed')).toBe('true');
    db.click();
    expect(loc.href).toBe('https://wlncw02.webflow.io/?stagepass=my-project.sp');
  });

  it('Debug toggle is disabled in a debug session without a session to return to', async () => {
    startSession('debug');
    await boot();
    const db = (await openCard()).card!.querySelectorAll<HTMLButtonElement>('.ft button')[1];
    expect(db.disabled).toBe(true);
  });

  it('message list: newest first, time, source and line, text only (never HTML)', async () => {
    startSession('my-project.sp');
    await boot();
    const sp = (window as any).sp;
    sp.warn('first <img src=x onerror=alert(1)>');
    sp.error('second', { a: 1 });
    const { card, q } = await openCard();
    const items = Array.from(card!.querySelectorAll('.it'));
    expect(items.length).toBe(2);
    expect(items[0].className).toContain('e');
    expect(items[0].querySelector('.tx')?.textContent).toBe('Error: second {"a":1}');
    expect(items[1].querySelector('.tx')?.textContent).toBe('Warning: first <img src=x onerror=alert(1)>');
    expect(card!.querySelector('img')).toBeNull();
    expect(items[0].querySelector('.mt')?.textContent).toMatch(/^\d\d:\d\d:\d\d( · .+:\d+)?$/);
    expect(q('.lh span:last-child')?.textContent).toBe('1 error · 1 warning');
  });

  it('captures script errors, failed loads and rejections with readable text', async () => {
    startSession('my-project.sp');
    await boot();
    window.dispatchEvent(new ErrorEvent('error', { message: 'boom', filename: 'https://x.test/js/app.js?v=2', lineno: 42 }));
    const local = document.createElement('script');
    local.src = 'https://my-project.sp/dist/main.js';
    document.body.appendChild(local);
    local.dispatchEvent(new Event('error'));
    const img = document.createElement('img');
    img.src = 'https://cdn.example.com/a.png';
    document.body.appendChild(img);
    img.dispatchEvent(new Event('error'));
    const rej = new Event('unhandledrejection');
    Object.defineProperty(rej, 'reason', { value: new Error('nope') });
    window.dispatchEvent(rej);
    const { card } = await openCard();
    const tx = Array.from(card!.querySelectorAll('.tx'), (t) => t.textContent);
    expect(tx).toEqual([
      'Error: Unhandled rejection: nope',
      'Error: Failed to load https://cdn.example.com/a.png',
      'Error: Local server not reachable: main.js. Run stagepass doctor',
      'Error: boom',
    ]);
    expect(card!.querySelectorAll('.mt')[3].textContent).toMatch(/ · app\.js:42$/);
    expect(parts().counters).toEqual(['4']);
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
    expect(q('.lh span:last-child')?.textContent).toBe('60 total, latest 50 shown');
    expect(parts().counters).toEqual(['60']);
    const s2 = 'y'.repeat(2000);
    sp.warn(s2);
    const t = card!.querySelector('.it .tx')!.textContent!;
    expect(t.length).toBe('Warning: '.length + 501);
    expect(t.endsWith('…')).toBe(true);
  });

  it('click on a message copies it and shows Copied', async () => {
    startSession('my-project.sp');
    await boot();
    const writeText = vi.fn(() => Promise.resolve());
    vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText } });
    (window as any).sp.error('copy me');
    const { card, q } = await openCard();
    const it = card!.querySelector<HTMLButtonElement>('.it')!;
    it.click();
    await Promise.resolve();
    await Promise.resolve();
    expect(writeText).toHaveBeenCalledWith(expect.stringMatching(/^\[error\] \d\d:\d\d:\d\d (\S+ )?copy me$/));
    expect(it.classList.contains('cp')).toBe(true);
    expect(it.querySelector('.ok')?.textContent).toBe('Copied to clipboard');
    expect(q('[aria-live]')?.textContent).toBe('Copied to clipboard');
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
});
