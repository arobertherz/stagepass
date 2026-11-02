import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createSession, serializeSession, SESSION_KEY } from '../session.js';

const FLAG = Symbol.for('stagepass.flag');

function startSession(domain: string) {
  localStorage.setItem(SESSION_KEY, serializeSession(createSession(domain)));
}

/** Run the loader IIFE (and optionally the lazy flag chunk) fresh. */
async function boot(withChunk = true) {
  vi.resetModules();
  await import('../index.js');
  if (withChunk) await import('../flag-entry.js');
}

function flagParts() {
  const host = document.getElementById('stagepass-flag');
  const root = host?.shadowRoot;
  const button = root?.querySelector('button') as HTMLButtonElement | null;
  const [warn, err] = Array.from(root?.querySelectorAll('span') || []) as HTMLElement[];
  return { host, root, button, warn, err, label: root?.querySelector('b')?.textContent };
}

describe('dev flag (Tally Pass)', () => {
  let reload: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    localStorage.clear();
    document.head.innerHTML = '';
    document.body.innerHTML = '';
    delete (window as any).stagepass;
    delete (window as any).sp;
    reload = vi.fn();
    vi.stubGlobal('location', {
      hostname: 'wlncw02.webflow.io',
      search: '',
      pathname: '/',
      hash: '',
      reload,
    });
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('is absent without a session and the flag chunk is never requested', async () => {
    await boot();
    expect(document.getElementById('stagepass-flag')).toBeNull();
    expect(document.querySelector('script[src*="flag.min.js"]')).toBeNull();
    expect((window as any).stagepass[FLAG]).toBeUndefined();
    expect((window as any).stagepass.vars.env).toBe('staging');
  });

  it('requests flag.min.js only during a session', async () => {
    startSession('my-project.sp');
    await boot(false);
    const s = document.querySelector('script[src*="flag.min.js"]') as HTMLScriptElement;
    expect(s).toBeTruthy();
    expect(s.src).toMatch(/^https:\/\/cdn\.jsdelivr\.net\/npm\/@stagepass\/loader@[^/]+\/dist\/flag\.min\.js$/);
    expect(s.async).toBe(true);
  });

  it('loads flag.min.js next to the loader when the loader src is known', async () => {
    startSession('my-project.sp');
    const loader = document.createElement('script');
    loader.src = 'https://cdn.jsdelivr.net/npm/@stagepass/loader@2/dist/loader.min.js?modules=cookies';
    document.head.appendChild(loader);
    await boot(false);
    const s = document.querySelector('script[src*="flag.min.js"]') as HTMLScriptElement;
    expect(s.src).toBe('https://cdn.jsdelivr.net/npm/@stagepass/loader@2/dist/flag.min.js');
  });

  it('draws the glow without blurred box-shadows and never slides in from off-screen', async () => {
    startSession('my-project.sp');
    await boot();
    const root = flagParts().root as ShadowRoot & { adoptedStyleSheets?: CSSStyleSheet[] };
    const sheets = root.adoptedStyleSheets || [];
    const css = sheets.length
      ? sheets.map((s) => Array.from(s.cssRules, (r) => r.cssText).join('')).join('')
      : root.querySelector('style')?.textContent || '';
    expect(css).toContain('radial-gradient(');
    // Only small, sharp shadows are allowed (inset highlight, 1-3px icon accents)
    const shadows = css.match(/box-shadow:[^;}]*/g) || [];
    expect(shadows.length).toBeGreaterThan(0);
    for (const m of shadows) {
      for (const layer of m.slice(11).split(/,(?![^(]*\))/)) {
        const lengths = layer.trim().split(/\s+/).filter((t) => /^-?(\d*\.)?\d+(px)?$/.test(t));
        expect(parseFloat(lengths[2] || '0'), m).toBeLessThanOrEqual(3);
      }
    }
    expect(css).not.toMatch(/@keyframes[^}]*translate/);
  });

  it('shows LOCAL in a shadow root with a session', async () => {
    startSession('my-project.sp');
    await boot();
    const { host, root, button, warn, err, label } = flagParts();
    expect(host).toBeTruthy();
    expect(root).toBeTruthy();
    expect(label).toBe('LOCAL');
    expect(button?.type).toBe('button');
    expect(button?.title).toContain('my-project.sp');
    expect(button?.getAttribute('aria-label')).toContain('Click to disconnect');
    expect(warn.hidden).toBe(true);
    expect(err.hidden).toBe(true);
    // Page CSS cannot reach inside: the light DOM host has no children
    expect(host?.children.length).toBe(0);
    // Hook is single-use
    expect((window as any).stagepass[FLAG]).toBeUndefined();
  });

  it('shows DEBUG for debug sessions', async () => {
    startSession('debug');
    await boot();
    expect(flagParts().label).toBe('DEBUG');
  });

  it('never shows a LIVE state', async () => {
    startSession('my-project.sp');
    await boot();
    expect(flagParts().root?.textContent).not.toMatch(/LIVE/);
  });

  it('counts sp.warn, sp.error, sp.log level and captured errors', async () => {
    startSession('my-project.sp');
    await boot();
    const sp = (window as any).sp;
    sp.warn('careful');
    sp.log('warn', 'via log');
    sp.error('boom');
    let f = flagParts();
    expect(f.warn.hidden).toBe(false);
    expect(f.warn.textContent).toBe('2');
    expect(f.err.textContent).toBe('1');

    window.dispatchEvent(new Event('error'));
    window.dispatchEvent(new Event('unhandledrejection'));
    f = flagParts();
    expect(f.err.textContent).toBe('3');
    expect(f.button?.title).toMatch(/2 warnings/);
    expect(f.button?.title).toMatch(/3 errors/);
  });

  it('counts warnings that happen before the chunk has loaded', async () => {
    startSession('my-project.sp');
    await boot(false);
    (window as any).sp.warn('early');
    await import('../flag-entry.js');
    expect(flagParts().warn.textContent).toBe('1');
  });

  it('caps the counter display at 99+', async () => {
    startSession('my-project.sp');
    await boot();
    for (let i = 0; i < 120; i++) (window as any).sp.error('x');
    expect(flagParts().err.textContent).toBe('99+');
  });

  it('click disconnects and reloads', async () => {
    startSession('my-project.sp');
    await boot();
    const events: unknown[] = [];
    (window as any).sp.on('session', (p: unknown) => events.push(p));
    flagParts().button?.click();
    expect(localStorage.getItem(SESSION_KEY)).toBeNull();
    expect(events).toEqual([{ active: false, domain: null, swap: false, debug: false }]);
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('does not count when no session is active', async () => {
    await boot();
    (window as any).sp.warn('ignored');
    window.dispatchEvent(new Event('error'));
    expect(document.getElementById('stagepass-flag')).toBeNull();
  });
});
