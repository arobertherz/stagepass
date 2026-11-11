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

describe('data-stagepass-nocache (per-asset permanent cache bust, production)', () => {
  beforeEach(() => {
    localStorage.clear();
    document.head.innerHTML = '';
    document.body.innerHTML = '';
    delete (window as any).stagepass;
    delete (window as any).sp;
    vi.stubGlobal('location', {
      hostname: 'www.example.com',
      href: 'https://www.example.com/',
      search: '',
      pathname: '/',
      hash: '',
      reload: vi.fn(),
    });
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('other assets keep current behaviour: no attribute, no _cb param', async () => {
    document.body.innerHTML =
      '<script data-stagepass data-src="https://cdn.example.com/a.js"></script>';
    await bootAs(loaderTag());
    await new Promise((r) => setTimeout(r, 0));
    const el = document.querySelector('script[src*="cdn.example.com"]') as HTMLScriptElement;
    expect(el.src).toBe('https://cdn.example.com/a.js');
  });

  it('bare boolean attribute appends a fresh ?_cb=<timestamp> on every page view', async () => {
    const before = Date.now();
    document.body.innerHTML =
      '<script data-stagepass data-stagepass-nocache data-src="https://cdn.example.com/embed.js"></script>';
    await bootAs(loaderTag());
    await new Promise((r) => setTimeout(r, 0));
    const el = document.querySelector('script[src*="cdn.example.com"]') as HTMLScriptElement;
    const m = el.src.match(/^https:\/\/cdn\.example\.com\/embed\.js\?_cb=(\d+)$/);
    expect(m).toBeTruthy();
    expect(Number(m![1])).toBeGreaterThanOrEqual(before);
    // Internal marker attribute must not leak onto the live replacement element
    expect(el.hasAttribute('data-stagepass-nocache')).toBe(false);
  });

  it('="true" behaves the same as the bare attribute', async () => {
    document.body.innerHTML =
      '<link rel="stylesheet" data-stagepass data-stagepass-nocache="true" data-href="https://cdn.example.com/embed.css">';
    await bootAs(loaderTag());
    await new Promise((r) => setTimeout(r, 0));
    const el = document.querySelector('link[href*="cdn.example.com"]') as HTMLLinkElement;
    expect(el.href).toMatch(/^https:\/\/cdn\.example\.com\/embed\.css\?_cb=\d+$/);
  });

  it('="false" turns it off, same as not set', async () => {
    document.body.innerHTML =
      '<script data-stagepass data-stagepass-nocache="false" data-src="https://cdn.example.com/embed.js"></script>';
    await bootAs(loaderTag());
    await new Promise((r) => setTimeout(r, 0));
    const el = document.querySelector('script[src*="cdn.example.com"]') as HTMLScriptElement;
    expect(el.src).toBe('https://cdn.example.com/embed.js');
  });

  it('combines with data-stagepass-v: ?v=<version>&_cb=<timestamp>, deterministic order', async () => {
    document.body.innerHTML =
      '<script data-stagepass data-stagepass-nocache data-stagepass-v="3.1.0" data-src="https://cdn.example.com/embed.js"></script>';
    await bootAs(loaderTag());
    await new Promise((r) => setTimeout(r, 0));
    const el = document.querySelector('script[src*="cdn.example.com"]') as HTMLScriptElement;
    expect(el.src).toMatch(/^https:\/\/cdn\.example\.com\/embed\.js\?v=3\.1\.0&_cb=\d+$/);
  });

  it('combines with the loader-level data-stagepass-version default', async () => {
    document.body.innerHTML =
      '<script data-stagepass data-stagepass-nocache data-src="https://cdn.example.com/embed.js"></script>';
    await bootAs(loaderTag({ 'data-stagepass-version': '2.4.0' }));
    await new Promise((r) => setTimeout(r, 0));
    const el = document.querySelector('script[src*="cdn.example.com"]') as HTMLScriptElement;
    expect(el.src).toMatch(/^https:\/\/cdn\.example\.com\/embed\.js\?v=2\.4\.0&_cb=\d+$/);
  });

  it('preserves an existing query string and hash fragment', async () => {
    document.body.innerHTML =
      '<script data-stagepass data-stagepass-nocache data-stagepass-v="1.2.3" data-src="https://cdn.example.com/embed.js?utm=x#frag"></script>';
    await bootAs(loaderTag());
    await new Promise((r) => setTimeout(r, 0));
    const el = document.querySelector('script[src*="cdn.example.com"]') as HTMLScriptElement;
    expect(el.src).toMatch(
      /^https:\/\/cdn\.example\.com\/embed\.js\?utm=x&v=1\.2\.3&_cb=\d+#frag$/
    );
  });

  it('is ignored during an active local/dev swap session (local behaviour unchanged)', async () => {
    startSession('my-project.sp');
    document.body.innerHTML =
      '<script data-stagepass data-stagepass-nocache data-stagepass-v="9.9.9" data-src="https://cdn.example.com/embed.js"></script>';
    await bootAs(loaderTag());
    await new Promise((r) => setTimeout(r, 0));
    const el = document.querySelector('script[src^="https://my-project.sp/"]') as HTMLScriptElement;
    expect(el).toBeTruthy();
    // Single local `_cb` stamp from the swap session, never `?v=`, and only one `_cb` param
    expect(el.src).toMatch(/^https:\/\/my-project\.sp\/embed\.js\?_cb=\d+$/);
    expect((el.src.match(/_cb=/g) || []).length).toBe(1);
  });

  it('works the same when the loader runs inside an iframe document', async () => {
    const iframe = document.createElement('iframe');
    document.body.appendChild(iframe);
    const idoc = iframe.contentDocument as Document;
    const iwin = iframe.contentWindow as unknown as Window & typeof globalThis;
    idoc.body.innerHTML =
      '<script data-stagepass data-stagepass-nocache data-stagepass-v="1.0.0" data-src="https://cdn.example.com/embed.js"></script>';
    const tag = idoc.createElement('script');
    tag.src = 'https://cdn.jsdelivr.net/npm/@stagepass/loader@2/dist/loader.min.js';
    idoc.head.appendChild(tag);
    Object.defineProperty(idoc, 'currentScript', { configurable: true, get: () => tag });

    vi.stubGlobal('document', idoc);
    vi.stubGlobal('window', iwin);
    vi.stubGlobal('location', {
      hostname: 'www.example.com',
      href: 'https://www.example.com/',
      search: '',
      pathname: '/',
      hash: '',
      reload: vi.fn(),
    });
    try {
      await boot();
      await new Promise((r) => setTimeout(r, 0));
      const el = idoc.querySelector('script[src*="cdn.example.com"]') as HTMLScriptElement;
      expect(el).toBeTruthy();
      expect(el.src).toMatch(/^https:\/\/cdn\.example\.com\/embed\.js\?v=1\.0\.0&_cb=\d+$/);
    } finally {
      delete (idoc as any).currentScript;
    }
  });
});
