import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createSession, serializeSession, SESSION_KEY } from '../session.js';
import {
  isSafeLiveUrl,
  parseLivePayload,
  swapLocalStylesheets,
  startLiveReload,
  LIVE_PATH,
  LIVE_HOOK,
} from '../live.js';

describe('live reload helpers', () => {
  it('accepts only same-host http(s) URLs at the fixed path', () => {
    expect(
      isSafeLiveUrl('https://demo.sp/__stagepass/live', 'https://demo.sp')
    ).toBe(true);
    expect(
      isSafeLiveUrl('https://evil.sp/__stagepass/live', 'https://demo.sp')
    ).toBe(false);
    expect(
      isSafeLiveUrl('https://demo.sp/other', 'https://demo.sp')
    ).toBe(false);
    expect(
      isSafeLiveUrl('javascript:alert(1)', 'https://demo.sp')
    ).toBe(false);
    expect(LIVE_PATH).toBe('/__stagepass/live');
  });

  it('parses known event types and ignores junk', () => {
    expect(parseLivePayload('{"type":"css","paths":["/dist/a.css"]}')).toEqual({
      type: 'css',
      paths: ['/dist/a.css'],
    });
    expect(parseLivePayload('{"type":"reload","paths":["/dist/a.js"]}')?.type).toBe(
      'reload'
    );
    expect(parseLivePayload('{"type":"eval"}')).toBeNull();
    expect(parseLivePayload('not-json')).toBeNull();
  });

  it('swaps local stylesheets with a cache-bust query and drops integrity', () => {
    document.head.innerHTML = '';
    const local = document.createElement('link');
    local.rel = 'stylesheet';
    local.href = 'https://demo.sp/dist/styles.css';
    local.setAttribute('integrity', 'sha384-abc');
    document.head.appendChild(local);
    const other = document.createElement('link');
    other.rel = 'stylesheet';
    other.href = 'https://cdn.example.com/styles.css';
    document.head.appendChild(other);

    const n = swapLocalStylesheets('https://demo.sp', document);
    expect(n).toBe(1);
    const links = Array.from(document.querySelectorAll('link[rel=stylesheet]'));
    expect(links).toHaveLength(2);
    const swapped = links.find((l) => (l as HTMLLinkElement).href.includes('demo.sp')) as HTMLLinkElement;
    expect(swapped.href).toMatch(/[?&]t=\d+/);
    expect(swapped.getAttribute('integrity')).toBeNull();
    expect(
      links.some((l) => (l as HTMLLinkElement).href.includes('cdn.example.com'))
    ).toBe(true);
  });
});

describe('startLiveReload with fake EventSource', () => {
  class FakeES {
    static instances: FakeES[] = [];
    url: string;
    onmessage: ((ev: MessageEvent) => void) | null = null;
    onerror: (() => void) | null = null;
    closed = false;
    constructor(url: string) {
      this.url = url;
      FakeES.instances.push(this);
    }
    close() {
      this.closed = true;
    }
    emit(data: string) {
      this.onmessage?.({ data } as MessageEvent);
    }
    fail() {
      this.onerror?.();
    }
  }

  beforeEach(() => {
    FakeES.instances = [];
    document.head.innerHTML = '';
  });

  afterEach(() => {
    document.head.innerHTML = '';
  });

  it('handles css without reload and reloads on js; closes on first error', () => {
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = 'https://demo.sp/dist/styles.css';
    document.head.appendChild(link);

    const reload = vi.fn();
    const log = vi.fn();
    const stop = startLiveReload({
      url: 'https://demo.sp/__stagepass/live',
      localBase: 'https://demo.sp',
      debug: true,
      log,
      EventSourceImpl: FakeES as unknown as typeof EventSource,
      reload,
      doc: document,
    });

    expect(FakeES.instances).toHaveLength(1);
    expect(log).toHaveBeenCalledWith('Live reload listening.');

    FakeES.instances[0].emit(JSON.stringify({ type: 'css', paths: ['/dist/styles.css'] }));
    expect(reload).not.toHaveBeenCalled();
    const href = (document.querySelector('link[rel=stylesheet]') as HTMLLinkElement).href;
    expect(href).toMatch(/[?&]t=\d+/);

    FakeES.instances[0].emit(JSON.stringify({ type: 'reload', paths: ['/dist/main.js'] }));
    expect(reload).toHaveBeenCalledTimes(1);
    expect(FakeES.instances[0].closed).toBe(true);

    const stop2 = startLiveReload({
      url: 'https://demo.sp/__stagepass/live',
      localBase: 'https://demo.sp',
      debug: true,
      log,
      EventSourceImpl: FakeES as unknown as typeof EventSource,
      reload,
      doc: document,
    });
    FakeES.instances[1].fail();
    expect(FakeES.instances[1].closed).toBe(true);
    expect(log).toHaveBeenCalledWith('Live reload unavailable (closed).');
    stop();
    stop2();
  });

  it('ignores unsafe urls', () => {
    const stop = startLiveReload({
      url: 'https://evil.example/__stagepass/live',
      localBase: 'https://demo.sp',
      EventSourceImpl: FakeES as unknown as typeof EventSource,
    });
    expect(FakeES.instances).toHaveLength(0);
    stop();
  });
});

describe('live hook placement (flag chunk, not core)', () => {
  const LIVE = Symbol.for(LIVE_HOOK);
  const dist = path.join(path.dirname(fileURLToPath(import.meta.url)), '../../dist');

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

  it('core loader.min.js does not embed the live hook or SSE path', () => {
    const src = readFileSync(path.join(dist, 'loader.min.js'), 'utf-8');
    expect(src).not.toContain('stagepass.live.v1');
    expect(src).not.toContain('__stagepass/live');
  });

  it('without a session: no extra script requests beyond the loader itself', async () => {
    vi.resetModules();
    await import('../index.js');
    expect(document.querySelectorAll('script').length).toBe(0);
    expect((window as any).stagepass[LIVE]).toBeUndefined();
  });

  it('core alone does not define the live hook or request live.min.js', async () => {
    localStorage.setItem(SESSION_KEY, serializeSession(createSession('demo.sp')));
    vi.resetModules();
    await import('../index.js');
    expect((window as any).stagepass[LIVE]).toBeUndefined();
    expect(document.querySelector('script[src*="live.min.js"]')).toBeNull();
    expect(document.querySelector('script[src*="flag.min.js"]')).toBeTruthy();
  });

  it('flag chunk defines the live hook and appends live.min.js during a swap session', async () => {
    localStorage.setItem(SESSION_KEY, serializeSession(createSession('demo.sp')));
    const loader = document.createElement('script');
    loader.src = 'https://cdn.jsdelivr.net/npm/@stagepass/loader@2/dist/loader.min.js';
    document.head.appendChild(loader);
    vi.resetModules();
    await import('../index.js');
    await import('../flag-entry.js');
    expect(typeof (window as any).stagepass[LIVE]).toBe('function');
    const live = document.querySelector('script[src*="live.min.js"]') as HTMLScriptElement;
    expect(live).toBeTruthy();
    expect(live.src).toBe('https://cdn.jsdelivr.net/npm/@stagepass/loader@2/dist/live.min.js');
    expect(live.async).toBe(true);
  });

  it('debug session: flag chunk does not load live.min.js', async () => {
    localStorage.setItem(SESSION_KEY, serializeSession(createSession('debug')));
    vi.resetModules();
    await import('../index.js');
    await import('../flag-entry.js');
    expect((window as any).stagepass[LIVE]).toBeUndefined();
    expect(document.querySelector('script[src*="live.min.js"]')).toBeNull();
  });
});
