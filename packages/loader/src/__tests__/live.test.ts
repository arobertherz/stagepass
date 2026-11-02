import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  isSafeLiveUrl,
  parseLivePayload,
  swapLocalStylesheets,
  startLiveReload,
  LIVE_PATH,
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
