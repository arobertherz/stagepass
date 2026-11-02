import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createSession, serializeSession, SESSION_KEY } from '../session.js';

function startSession(domain: string) {
  localStorage.setItem(SESSION_KEY, serializeSession(createSession(domain)));
}

async function boot() {
  vi.resetModules();
  await import('../index.js');
}

async function bootAs(el: HTMLScriptElement) {
  document.head.appendChild(el);
  Object.defineProperty(document, 'currentScript', { configurable: true, get: () => el });
  try {
    await boot();
  } finally {
    delete (document as any).currentScript;
  }
}

function loaderTag(attrs: Record<string, string> = {}) {
  const s = document.createElement('script');
  s.src = 'https://cdn.jsdelivr.net/npm/@stagepass/loader@2/dist/loader.min.js';
  for (const [k, v] of Object.entries(attrs)) s.setAttribute(k, v);
  return s;
}

describe('live-src zero-cost mode', () => {
  let loc: Record<string, unknown>;

  beforeEach(() => {
    localStorage.clear();
    document.head.innerHTML = '';
    document.body.innerHTML = '';
    delete (window as any).stagepass;
    delete (window as any).sp;
    loc = {
      hostname: 'www.example.com',
      href: 'https://www.example.com/',
      search: '',
      pathname: '/',
      hash: '',
      reload: vi.fn(),
    };
    vi.stubGlobal('location', loc);
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('without opt-in, native src tags with data-stagepass are left alone even with a session', async () => {
    startSession('my-project.sp');
    document.body.innerHTML =
      '<script data-stagepass src="https://cdn.example.com/a.js" integrity="sha256-abc"></script>';
    await bootAs(loaderTag());
    await new Promise((r) => setTimeout(r, 0));
    const el = document.querySelector('script[data-stagepass]') as HTMLScriptElement;
    // Legacy process() may mark the node; without data-src it must not rewrite src
    expect(el.src).toContain('cdn.example.com/a.js');
    expect(el.getAttribute('integrity')).toBe('sha256-abc');
    expect(el.src).not.toContain('my-project.sp');
  });

  it('with opt-in and no session, native src tags are not rewritten', async () => {
    document.body.innerHTML =
      '<script data-stagepass src="https://cdn.example.com/a.js" integrity="sha256-abc"></script>';
    await bootAs(loaderTag({ 'data-stagepass-live-src': 'true' }));
    await new Promise((r) => setTimeout(r, 0));
    const el = document.querySelector('script[data-stagepass]') as HTMLScriptElement;
    expect(el.src).toContain('cdn.example.com/a.js');
    expect(el.getAttribute('integrity')).toBe('sha256-abc');
    expect(document.querySelector('script[src*="flag.min.js"]')).toBeNull();
  });

  it('with opt-in and session, rewrites src/href to local, drops integrity, sets crossorigin', async () => {
    startSession('my-project.sp');
    document.body.innerHTML =
      '<script data-stagepass src="https://cdn.example.com/js/main.js" integrity="sha256-abc"></script>' +
      '<link rel="stylesheet" data-stagepass href="https://cdn.example.com/css/main.css" integrity="sha256-def">';
    await bootAs(loaderTag({ 'data-stagepass-live-src': 'true' }));
    await new Promise((r) => setTimeout(r, 0));
    const sc = document.querySelector('script[data-stagepass]') as HTMLScriptElement;
    const ln = document.querySelector('link[data-stagepass]') as HTMLLinkElement;
    expect(sc.src).toMatch(/^https:\/\/my-project\.sp\/main\.js\?_cb=\d+$/);
    expect(ln.href).toMatch(/^https:\/\/my-project\.sp\/main\.css\?_cb=\d+$/);
    expect(sc.hasAttribute('integrity')).toBe(false);
    expect(ln.hasAttribute('integrity')).toBe(false);
    expect(sc.crossOrigin).toBe('anonymous');
    expect(ln.crossOrigin).toBe('anonymous');
    expect(sc.getAttribute('data-stagepass-processed')).toBe('true');
  });

  it('respects data-stagepass-path for live-src assets', async () => {
    startSession('my-project.sp');
    document.body.innerHTML =
      '<script data-stagepass data-stagepass-path="js/app.js" src="https://cdn.example.com/bundle.min.js"></script>';
    await bootAs(loaderTag({ 'data-stagepass-live-src': 'true' }));
    await new Promise((r) => setTimeout(r, 0));
    const sc = document.querySelector('script[data-stagepass]') as HTMLScriptElement;
    expect(sc.src).toMatch(/^https:\/\/my-project\.sp\/js\/app\.js\?_cb=\d+$/);
  });

  it('legacy data-src still swaps when live-src is enabled', async () => {
    startSession('my-project.sp');
    document.body.innerHTML =
      '<script data-stagepass data-src="https://cdn.example.com/legacy.js"></script>';
    await bootAs(loaderTag({ 'data-stagepass-live-src': 'true' }));
    await new Promise((r) => setTimeout(r, 0));
    const sc = document.querySelector('script[src^="https://my-project.sp/"]') as HTMLScriptElement;
    expect(sc).toBeTruthy();
    expect(sc.src).toMatch(/legacy\.js\?_cb=\d+$/);
    expect(document.querySelector('script[data-src]')).toBeNull();
  });

  it('swapEl never copies a production src onto the replacement script', async () => {
    startSession('my-project.sp');
    // Legacy tag that still has a production src (Firefox live-src converts to this shape)
    document.body.innerHTML =
      '<script data-stagepass data-src="https://cdn.example.com/js/main.js" src="https://cdn.example.com/js/main.js" integrity="sha256-abc"></script>';
    await bootAs(loaderTag());
    await new Promise((r) => setTimeout(r, 0));
    const local = document.querySelector('script[src^="https://my-project.sp/"]') as HTMLScriptElement;
    expect(local).toBeTruthy();
    expect(local.src).toMatch(/main\.js\?_cb=\d+$/);
    expect(local.src).not.toContain('cdn.example.com');
    expect(local.getAttribute('integrity')).toBeNull();
    expect(document.querySelector('script[data-src]')).toBeNull();
  });

  it('Firefox live-src path swaps via beforescriptexecute → data-src → swapEl', async () => {
    startSession('my-project.sp');
    Object.defineProperty(Document.prototype, 'onbeforescriptexecute', {
      configurable: true,
      enumerable: true,
      writable: true,
      value: null,
    });
    try {
      document.body.innerHTML =
        '<script data-stagepass src="https://cdn.example.com/js/main.js" integrity="sha256-abc"></script>';
      await bootAs(loaderTag({ 'data-stagepass-live-src': 'true' }));
      const pending = document.querySelector(
        'script[data-stagepass][src*="cdn.example.com"]:not([data-stagepass-processed])'
      ) as HTMLScriptElement | null;
      // jsdom may already have fired beforescriptexecute; if not, drive the handler
      if (pending) {
        pending.dispatchEvent(new Event('beforescriptexecute', { cancelable: true, bubbles: true }));
        await new Promise((r) => setTimeout(r, 0));
      }
      const local = document.querySelector('script[src^="https://my-project.sp/"]') as HTMLScriptElement;
      expect(local).toBeTruthy();
      expect(local.src).toMatch(/main\.js\?_cb=\d+$/);
      expect(document.querySelector('script[src*="cdn.example.com"]')).toBeNull();
    } finally {
      delete (Document.prototype as any).onbeforescriptexecute;
    }
  });
});
