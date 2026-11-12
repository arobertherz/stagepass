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

function sp() {
  return (window as any).sp;
}

describe('runtime guards the mutation probe missed', () => {
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
    delete (Document.prototype as any).onbeforescriptexecute;
  });

  it('treats 127.0.0.1 as local even though the hostname has no port suffix', async () => {
    vi.stubGlobal('location', {
      hostname: '127.0.0.1',
      href: 'http://127.0.0.1/',
      search: '',
      pathname: '/',
      hash: '',
      reload: vi.fn(),
    });
    await bootAs(loaderTag());
    expect(sp().vars.isLocal).toBe(true);
    expect(sp().vars.env).toBe('local');
    expect(sp().vars.domain).toBe('127.0.0.1');
  });

  it('reports the page hostname in production and the .sp domain while swapping', async () => {
    await bootAs(loaderTag());
    expect(sp().vars.domain).toBe('www.example.com');

    vi.resetModules();
    delete (window as any).stagepass;
    delete (window as any).sp;
    startSession('my-project.sp');
    await bootAs(loaderTag());
    expect(sp().vars.domain).toBe('my-project.sp');
  });

  it('resolveLocalUrl stays empty without a path, and reuses the session timestamp', async () => {
    startSession('my-project.sp');
    await bootAs(loaderTag());
    const ts = sp().vars.timestamp as number;
    expect(ts).toBeGreaterThan(0);
    expect(sp().resolveLocalUrl('')).toBe('');
    expect(sp().resolveLocalUrl('js/app.js')).toBe(
      `https://my-project.sp/js/app.js?_cb=${ts}`
    );
    vi.spyOn(Date, 'now').mockReturnValue(ts + 50_000);
    expect(sp().resolveLocalUrl('js/app.js')).toBe(
      `https://my-project.sp/js/app.js?_cb=${ts}`
    );
  });

  it('does not build a local URL when the production URL has no filename', async () => {
    startSession('my-project.sp');
    document.body.innerHTML =
      '<script data-stagepass data-src="https://cdn.example.com/"></script>';
    await bootAs(loaderTag());
    await new Promise((r) => setTimeout(r, 0));
    const el = document.querySelector('script[src*="cdn.example.com"]') as HTMLScriptElement;
    expect(el).toBeTruthy();
    expect(el.src).not.toContain('my-project.sp');
    expect(document.querySelector('script[src*="my-project.sp"]')).toBeNull();
  });

  it('logs a restored localStorage session once', async () => {
    startSession('my-project.sp');
    const lines: string[] = [];
    console.log = (...args: unknown[]) => {
      lines.push(args.map(String).join(' '));
    };
    await bootAs(loaderTag());
    const hits = lines.filter((line) => line.includes('connected to') && line.includes('my-project.sp'));
    expect(hits).toHaveLength(1);
  });

  it('does not mute console.log in production unless mute-console is set', async () => {
    const log = console.log;
    await bootAs(loaderTag());
    expect(console.log).toBe(log);
    console.log('still-on');
    expect(log).toHaveBeenCalledWith('still-on');
  });

  it('does not mute console.log on localhost even when mute-console is set', async () => {
    vi.stubGlobal('location', {
      hostname: 'localhost',
      href: 'http://localhost/',
      search: '',
      pathname: '/',
      hash: '',
      reload: vi.fn(),
    });
    const log = vi.fn();
    console.log = log;
    await bootAs(loaderTag({ 'data-stagepass-mute-console': 'true' }));
    expect(console.log).toBe(log);
  });

  it('updates viewport width from the resize event', async () => {
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 111 });
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: 222 });
    await bootAs(loaderTag());
    expect(sp().vars.client.viewport.width).toBe(111);
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 333 });
    window.dispatchEvent(new Event('resize'));
    expect(sp().vars.client.viewport.width).toBe(333);
  });

  it('Firefox live-src cancels a production script and ignores an already-local src', async () => {
    Object.defineProperty(Document.prototype, 'onbeforescriptexecute', {
      configurable: true,
      writable: true,
      value: null,
    });
    startSession('my-project.sp');
    await bootAs(loaderTag({ 'data-stagepass-live-src': 'true' }));

    const cdn = document.createElement('script');
    cdn.setAttribute('data-stagepass', '');
    cdn.src = 'https://cdn.example.com/js/main.js';
    document.body.appendChild(cdn);
    const cdnEvent = new Event('beforescriptexecute', { cancelable: true, bubbles: true });
    cdn.dispatchEvent(cdnEvent);
    expect(cdnEvent.defaultPrevented).toBe(true);

    const local = document.createElement('script');
    local.setAttribute('data-stagepass', '');
    local.src = 'https://my-project.sp/js/already.js';
    document.body.appendChild(local);
    const localEvent = new Event('beforescriptexecute', { cancelable: true, bubbles: true });
    local.dispatchEvent(localEvent);
    expect(localEvent.defaultPrevented).toBe(false);
    expect(local.getAttribute('src') || local.src).toContain('my-project.sp/js/already.js');
  });

  it('records each console.error during a session', async () => {
    startSession('my-project.sp');
    console.error = vi.fn();
    await bootAs(loaderTag());
    await import('../flag-entry.js');
    console.error('first-unique');
    console.error('second-unique');
    const root = document.getElementById('stagepass-flag')?.shadowRoot as ShadowRoot;
    expect(root.querySelector('button')?.getAttribute('aria-label')).toMatch(/2 errors/);
  });

  it('marks a live-src file failed when the local server answers without CORS and there is no retry', async () => {
    startSession('my-project.sp');
    document.body.innerHTML =
      '<script data-stagepass src="https://cdn.example.com/js/cors-probe.js"></script>';
    const fetchMock = vi.fn()
      .mockRejectedValueOnce(new Error('cors'))
      .mockResolvedValueOnce({ ok: true, status: 200 });
    vi.stubGlobal('fetch', fetchMock);
    await bootAs(loaderTag({ 'data-stagepass-live-src': 'true' }));
    await import('../flag-entry.js');
    const el = document.querySelector('script[src*="cors-probe"]') as HTMLScriptElement;
    expect(el.src).toContain('my-project.sp/cors-probe.js');
    el.dispatchEvent(new Event('error'));
    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => setTimeout(r, 0));
    const root = document.getElementById('stagepass-flag')?.shadowRoot as ShadowRoot;
    const pill = root.querySelector('button') as HTMLButtonElement;
    pill.dispatchEvent(Object.assign(new Event('pointerenter', { bubbles: true }), { pointerType: 'mouse' }));
    await import('../flag-card-entry.js');
    pill.click();
    const card = root.querySelector('[role=dialog]');
    expect(card?.textContent).toContain('Failed to load cors-probe.js');
  });
});
