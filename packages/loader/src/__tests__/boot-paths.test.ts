import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createSession, serializeSession, SESSION_KEY } from '../session.js';

/**
 * Boot paths in src/index.ts. Imports are dynamic so each case controls
 * location and storage before the IIFE runs. vitest related follows that
 * import, including modules index.ts loads (mutation gate #155).
 */

const logs: unknown[][] = [];
const warns: unknown[][] = [];
let scheme: 'dark' | 'light' | 'none' = 'none';
const mediaListeners: Array<() => void> = [];

function startSession(domain: string) {
  localStorage.setItem(SESSION_KEY, serializeSession(createSession(domain)));
}

function setLocation(overrides: Record<string, unknown> = {}) {
  const reload = vi.fn();
  vi.stubGlobal('location', {
    hostname: 'www.example.com',
    href: 'https://www.example.com/',
    origin: 'https://www.example.com',
    search: '',
    pathname: '/',
    hash: '',
    reload,
    ...overrides,
  });
  return { reload };
}

async function boot() {
  vi.resetModules();
  await import('../index.js');
}

function loaderTag(attrs: Record<string, string> = {}) {
  const s = document.createElement('script');
  s.src = 'https://cdn.jsdelivr.net/npm/@stagepass/loader@2/dist/loader.min.js';
  for (const [k, v] of Object.entries(attrs)) s.setAttribute(k, v);
  return s;
}

async function bootAs(el: HTMLScriptElement) {
  document.head.appendChild(el);
  Object.defineProperty(document, 'currentScript', { configurable: true, get: () => el });
  try {
    await boot();
  } finally {
    delete (document as unknown as { currentScript?: unknown }).currentScript;
  }
}

function sp() {
  return (window as unknown as { sp: any }).sp;
}

function flush() {
  return new Promise((r) => setTimeout(r, 0));
}

async function cardTexts(): Promise<string[]> {
  await import('../flag-entry.js');
  const host = document.getElementById('stagepass-flag') as HTMLElement;
  const root = host.shadowRoot as ShadowRoot;
  const pill = root.querySelector('button') as HTMLButtonElement;
  pill.dispatchEvent(Object.assign(new Event('pointerenter', { bubbles: true }), { pointerType: 'mouse' }));
  await import('../flag-card-entry.js');
  pill.click();
  const card = root.querySelector('[role=dialog]') as HTMLElement;
  return [...card.querySelectorAll('.tx')].map((n) => n.textContent || '');
}

function joined(calls: unknown[][]) {
  return calls.map((args) => args.map(String).join(' ')).join('\n');
}

function installMatchMedia() {
  mediaListeners.length = 0;
  vi.stubGlobal('matchMedia', (query: string) => ({
    get matches() {
      if (query.includes('dark')) return scheme === 'dark';
      if (query.includes('light')) return scheme === 'light';
      return false;
    },
    media: query,
    addEventListener(_type: string, fn: () => void) {
      mediaListeners.push(fn);
    },
    removeEventListener() {},
    addListener(fn: () => void) {
      mediaListeners.push(fn);
    },
    removeListener() {},
    dispatchEvent() {
      return true;
    },
  }));
}

describe('loader boot paths', () => {
  beforeEach(() => {
    logs.length = 0;
    warns.length = 0;
    scheme = 'none';
    localStorage.clear();
    sessionStorage.clear();
    document.head.innerHTML = '';
    document.body.innerHTML = '';
    delete (window as unknown as { stagepass?: unknown }).stagepass;
    delete (window as unknown as { sp?: unknown }).sp;
    delete (window as unknown as { myAlias?: unknown }).myAlias;
    delete (globalThis as unknown as { myAlias?: unknown }).myAlias;
    delete (window as unknown as { stagepassFlagBase?: unknown }).stagepassFlagBase;
    delete (Document.prototype as unknown as { onbeforescriptexecute?: unknown }).onbeforescriptexecute;
    setLocation();
    installMatchMedia();
    vi.spyOn(history, 'replaceState').mockImplementation(() => {});
    vi.spyOn(console, 'log').mockImplementation((...args) => {
      logs.push(args);
    });
    vi.spyOn(console, 'warn').mockImplementation((...args) => {
      warns.push(args);
    });
    vi.spyOn(console, 'error').mockImplementation(() => {});
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 800 });
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: 600 });
    Object.defineProperty(window, 'devicePixelRatio', { configurable: true, value: 2 });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    delete (Document.prototype as unknown as { onbeforescriptexecute?: unknown }).onbeforescriptexecute;
    delete (window as unknown as { myAlias?: unknown }).myAlias;
    delete (globalThis as unknown as { myAlias?: unknown }).myAlias;
    delete (window as unknown as { stagepassFlagBase?: unknown }).stagepassFlagBase;
  });

  it('exposes client, viewport and theme subscriptions from boot', async () => {
    await boot();
    const api = sp();
    expect(api.vars.version).toBe('0.0.0');
    expect(api.vars.env).toBe('production');
    expect(api.vars.isLocal).toBe(false);
    expect(joined(logs)).not.toMatch(/connected to|debug mode/);
    expect(api.vars.client.viewport).toEqual({ width: 800, height: 600, dpr: 2 });
    expect(api.vars.client.theme).toEqual({ preferred: 'no-preference', current: 'unknown' });

    expect(api.client()).toBe(api.vars.client);
    expect(api.client(undefined)).toBe(api.vars.client);
    expect(api.client('')).toBe(api.vars.client);
    expect(api.client('viewport')).toBe(api.vars.client.viewport);
    expect(api.client('no-such')).toBeUndefined();

    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 0 });
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: 10 });
    Object.defineProperty(window, 'devicePixelRatio', { configurable: true, value: 0 });
    window.dispatchEvent(new Event('resize'));
    expect(api.vars.client.viewport).toEqual({ width: 0, height: 10, dpr: 1 });

    const seen: unknown[] = [];
    const off = api.on('theme', (payload: unknown) => seen.push(payload));
    expect(typeof off).toBe('function');
    scheme = 'dark';
    expect(mediaListeners.length).toBeGreaterThan(0);
    mediaListeners[0]();
    expect(seen).toHaveLength(1);
    expect((seen[0] as { preferred: string }).preferred).toBe('dark');
    expect(api.vars.client.theme.preferred).toBe('dark');
    off();
    scheme = 'light';
    mediaListeners[0]();
    expect(seen).toHaveLength(1);

    const sessions: unknown[] = [];
    const offSession = api.on('session', (payload: unknown) => sessions.push(payload));
    expect(typeof offSession).toBe('function');
    offSession();

    const noop = api.on('nope', () => {
      throw new Error('should not run');
    });
    expect(typeof noop).toBe('function');
    expect(() => noop()).not.toThrow();
    expect(() => api.on('toString', () => {})).not.toThrow();
    expect(typeof api.on('toString', () => {})).toBe('function');
  });

  it.each(['localhost:8080', '127.0.0.1:9'])('treats %s as local', async (hostname) => {
    setLocation({ hostname, href: `http://${hostname}/` });
    await boot();
    expect(sp().vars.isLocal).toBe(true);
    expect(sp().vars.env).toBe('local');
    expect(sp().vars.domain).toBe(hostname);
    expect(sp().resolveLocalUrl('js/app.js')).toBe('');
  });

  it('mutes every console method in production when mute-console is true', async () => {
    const methods = ['log', 'warn', 'error', 'info', 'debug'] as const;
    const hits = Object.fromEntries(methods.map((name) => [name, 0])) as Record<(typeof methods)[number], number>;
    for (const name of methods) {
      console[name] = () => {
        hits[name] += 1;
      };
    }
    await bootAs(loaderTag({ 'data-stagepass-mute-console': 'true' }));
    for (const name of methods) {
      console[name]('secret-' + name);
      expect(hits[name]).toBe(0);
    }
  });

  it('logs a URL session once, debug text for debug, and rejects an invalid domain', async () => {
    setLocation({ search: '?stagepass=foo.sp', href: 'https://www.example.com/?stagepass=foo.sp' });
    await boot();
    const connected = logs.filter((args) => joined([args]).includes('connected to: foo.sp'));
    expect(connected).toHaveLength(1);
    expect(sp().vars.domain).toBe('foo.sp');

    logs.length = 0;
    vi.resetModules();
    delete (window as unknown as { sp?: unknown }).sp;
    delete (window as unknown as { stagepass?: unknown }).stagepass;
    localStorage.clear();
    setLocation({ search: '?stagepass=debug', href: 'https://www.example.com/?stagepass=debug' });
    await boot();
    expect(joined(logs)).toMatch(/debug mode enabled/);
    expect(joined(logs)).not.toMatch(/connected to/);
    expect(sp().vars.domain).toBe('www.example.com');

    logs.length = 0;
    warns.length = 0;
    vi.resetModules();
    delete (window as unknown as { sp?: unknown }).sp;
    delete (window as unknown as { stagepass?: unknown }).stagepass;
    localStorage.clear();
    setLocation({ search: '?stagepass=evil.com', href: 'https://www.example.com/?stagepass=evil.com' });
    await boot();
    expect(joined(warns)).toMatch(/Invalid domain: evil\.com/);
    expect(localStorage.getItem(SESSION_KEY)).toBeNull();
    expect(sp().vars.domain).toBe('www.example.com');
    expect(sp().vars.isLocal).toBe(false);
  });

  it('assigns a free alias and ignores an invalid one', async () => {
    await bootAs(loaderTag({ 'data-stagepass-alias': 'myAlias' }));
    expect((window as unknown as { myAlias: unknown }).myAlias).toBe(sp());
    expect((globalThis as unknown as { myAlias: unknown }).myAlias).toBe(sp());

    delete (window as unknown as { myAlias?: unknown }).myAlias;
    delete (globalThis as unknown as { myAlias?: unknown }).myAlias;
    delete (window as unknown as { sp?: unknown }).sp;
    delete (window as unknown as { stagepass?: unknown }).stagepass;
    document.head.innerHTML = '';
    await bootAs(loaderTag({ 'data-stagepass-alias': '2bad' }));
    expect((window as unknown as { '2bad'?: unknown })['2bad']).toBeUndefined();
    expect((globalThis as unknown as { '2bad'?: unknown })['2bad']).toBeUndefined();
  });

  it('prefers currentScript over a later loader script', async () => {
    startSession('my-project.sp');
    const first = loaderTag({ 'data-stagepass-flag-base': 'https://first.example/a/' });
    const second = loaderTag({ 'data-stagepass-flag-base': 'https://second.example/b/' });
    document.head.append(first, second);
    Object.defineProperty(document, 'currentScript', { configurable: true, get: () => first });
    try {
      await boot();
    } finally {
      delete (document as unknown as { currentScript?: unknown }).currentScript;
    }
    const flag = document.querySelector('script[src*="flag.min.js"]') as HTMLScriptElement;
    expect(flag.src).toBe('https://first.example/a/flag.min.js');
    expect(flag.async).toBe(true);
    expect(flag.parentElement).toBe(document.head);
  });

  it('warns on a non-string flag base and stays quiet for a valid one', async () => {
    startSession('my-project.sp');
    (window as unknown as { stagepassFlagBase: unknown }).stagepassFlagBase = 12;
    await boot();
    expect(joined(warns)).toMatch(/Ignored flag base/);
    expect((document.querySelector('script[src*="flag.min.js"]') as HTMLScriptElement).src).toMatch(
      /^https:\/\/cdn\.jsdelivr\.net\/npm\/@stagepass\/loader@0\.0\.0\/dist\/flag\.min\.js$/
    );

    warns.length = 0;
    vi.resetModules();
    delete (window as unknown as { sp?: unknown }).sp;
    delete (window as unknown as { stagepass?: unknown }).stagepass;
    document.head.innerHTML = '';
    document.body.innerHTML = '';
    (window as unknown as { stagepassFlagBase: string }).stagepassFlagBase = 'https://assets.example.com/sp/';
    await boot();
    expect((document.querySelector('script[src*="flag.min.js"]') as HTMLScriptElement).src).toBe(
      'https://assets.example.com/sp/flag.min.js'
    );
    expect(joined(warns)).not.toMatch(/Ignored flag base/);
  });

  it('records console output, stack location and live asset failures during a session', async () => {
    startSession('my-project.sp');
    await boot();
    await import('../flag-entry.js');
    const api = sp();

    const beforeLog = logs.length;
    api.log('ping-marker');
    const ping = joined(logs.slice(beforeLog));
    expect(ping).toContain('ping-marker');
    expect(ping).toMatch(/\|\s*\S+\.\w+:\d+/);

    const beforeErr = logs.length;
    api.error('boom-err');
    const errCall = logs.slice(beforeErr).find((args) => args.includes('boom-err'));
    expect(errCall?.[0]).toMatch(/%c/);
    expect(String(errCall?.[1])).toMatch(/color:\s*red/);

    api.log('warn', 'shifted');
    console.error('plain-marker');
    console.error(null, 0, false, { hello: 'world' });

    function makeErr() {
      return new Error('from-make');
    }
    const made = makeErr();
    console.error('wrapped', made);
    const madeFrame = made.stack!.match(/([a-z][\w+.-]*:\/\/[^\s()]+?):(\d+):(\d+)/i);
    expect(madeFrame).toBeTruthy();

    window.dispatchEvent(new ErrorEvent('error', { message: 'boom-nofile', filename: '', lineno: 3, colno: 4 }));

    const img = document.createElement('img');
    img.src = 'https://cdn.example.com/pic.png';
    document.body.appendChild(img);
    img.dispatchEvent(new Event('error'));

    const host = document.getElementById('stagepass-flag') as HTMLElement;
    const root = host.shadowRoot as ShadowRoot;
    const pill = root.querySelector('button') as HTMLButtonElement;
    pill.dispatchEvent(Object.assign(new Event('pointerenter', { bubbles: true }), { pointerType: 'mouse' }));
    await import('../flag-card-entry.js');
    pill.click();
    const card = root.querySelector('[role=dialog]') as HTMLElement;
    const texts = [...card.querySelectorAll('.tx')].map((n) => n.textContent);
    expect(texts).toContain('Warning: shifted');
    expect(texts.join('\n')).not.toContain('warn shifted');
    expect(texts).toContain('Error: plain-marker');
    expect(texts).toContain('Error: null 0 false {hello: "world"}');
    expect(texts).toContain('Error: boom-nofile');
    expect(texts).toContain('Error: Failed to load https://cdn.example.com/pic.png');

    const detail = (needle: string) => {
      const item = [...card.querySelectorAll('.it')].find((n) => n.textContent?.includes(needle));
      expect(item, needle).toBeTruthy();
      return item!.parentElement!.querySelector('.lo')?.textContent ?? '';
    };
    expect(detail('plain-marker')).toMatch(/\.\w+:\d+:\d+/);
    expect(detail('wrapped')).toContain(`${madeFrame![1].split('/').pop()}:${madeFrame![2]}:${madeFrame![3]}`);
    expect(detail('boom-nofile')).toContain(':3:4');
    expect(detail('boom-nofile')).not.toMatch(/cross-origin/);
    expect(detail('pic.png')).toMatch(/^live · https:\/\/cdn\.example\.com\/pic\.png/);

    const sessions: unknown[] = [];
    api.on('session', (payload: unknown) => sessions.push(payload));
    const end = [...card.querySelectorAll('button')].find((b) => b.textContent === 'End session') as HTMLButtonElement;
    const beforeEnd = logs.length;
    end.click();
    expect(joined(logs.slice(beforeEnd))).toMatch(/disconnected/);
    expect(sessions).toEqual([{ active: false, domain: null, swap: false, debug: false }]);
  });

  it('swaps a relative data-src and does not mark a URL with no filename as local', async () => {
    startSession('my-project.sp');
    document.body.innerHTML =
      '<script id="rel" data-stagepass data-custom="keep" data-src="assets/app.js?x=1"></script>' +
      '<script id="bare" data-stagepass data-src="https://cdn.example.com/"></script>';
    const original = document.getElementById('rel') as HTMLScriptElement;
    await boot();
    await flush();
    expect(original.isConnected).toBe(false);
    expect(original.getAttribute('data-stagepass-processed')).toBe('true');
    const rel = document.querySelector('script[src*="app.js"]') as HTMLScriptElement;
    expect(rel.src).toMatch(/^https:\/\/my-project\.sp\/app\.js\?_cb=\d+$/);
    expect(rel.getAttribute('data-custom')).toBe('keep');
    expect(rel.hasAttribute('data-src')).toBe(false);
    expect(rel.hasAttribute('data-stagepass')).toBe(false);
    const bare = document.querySelector('script[src="https://cdn.example.com/"]') as HTMLScriptElement;
    expect(bare).toBeTruthy();
    expect(bare.hasAttribute('crossorigin')).toBe(false);
    expect(document.querySelector('script[src*="my-project.sp/"][src$="/"]')).toBeNull();
  });

  it('cancels a non-bubbling beforescriptexecute on Firefox', async () => {
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
    await flush();
    const event = new Event('beforescriptexecute', { cancelable: true, bubbles: false });
    cdn.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
    await flush();
    expect(document.querySelector('script[src*="my-project.sp/main.js"]')).toBeTruthy();
  });

  it('rewrites a live-src node added after boot and leaves unrelated scripts alone', async () => {
    startSession('my-project.sp');
    await bootAs(loaderTag({ 'data-stagepass-live-src': 'true' }));
    const late = document.createElement('script');
    late.setAttribute('data-stagepass', '');
    late.src = 'https://cdn.example.com/js/late.js';
    const plain = document.createElement('script');
    plain.src = 'https://cdn.example.com/plain.js';
    document.body.append(late, plain);
    await flush();
    expect(late.src).toContain('my-project.sp/late.js');
    expect(late.getAttribute('data-stagepass-processed')).toBe('true');
    expect(plain.src).toContain('cdn.example.com/plain.js');
    expect(plain.hasAttribute('data-stagepass-processed')).toBe(false);
  });

  it('keeps an explicit data-stagepass-path when the production URL has another filename', async () => {
    startSession('my-project.sp');
    const original = document.createElement('script');
    original.setAttribute('data-stagepass', '');
    original.setAttribute('data-stagepass-path', 'js/app.js');
    original.setAttribute('data-src', 'https://cdn.example.com/bundle.min.js');
    document.body.appendChild(original);
    await boot();
    await flush();
    expect(original.getAttribute('data-stagepass-processed')).toBe('true');
    const swapped = document.querySelector('script[src*="my-project.sp/"]') as HTMLScriptElement;
    expect(swapped.src).toMatch(/^https:\/\/my-project\.sp\/js\/app\.js\?_cb=\d+$/);
    expect(document.querySelector('script[src*="bundle.min.js"]')).toBeNull();
  });

  it('does not listen for DOMContentLoaded when the document is already complete', async () => {
    const types: string[] = [];
    const real = document.addEventListener.bind(document);
    vi.spyOn(document, 'addEventListener').mockImplementation((type: string, listener: any, options?: any) => {
      types.push(type);
      return real(type, listener, options);
    });
    Object.defineProperty(document, 'readyState', { configurable: true, get: () => 'complete' });
    try {
      startSession('my-project.sp');
      document.body.innerHTML = '<script data-stagepass data-src="https://cdn.example.com/a.js"></script>';
      await boot();
      await flush();
      expect(types).not.toContain('DOMContentLoaded');
      expect(document.querySelector('script[src*="my-project.sp/a.js"]')).toBeTruthy();
      const extra = document.createElement('script');
      extra.setAttribute('data-stagepass', '');
      extra.setAttribute('data-src', 'https://cdn.example.com/b.js');
      document.body.appendChild(extra);
      document.dispatchEvent(new Event('DOMContentLoaded'));
      await flush();
      expect(extra.getAttribute('data-src')).toBe('https://cdn.example.com/b.js');
      expect(document.querySelector('script[src*="my-project.sp/b.js"]')).toBeNull();
    } finally {
      delete (document as unknown as { readyState?: unknown }).readyState;
    }
  });

  it('records a page console.error for a restored debug session before any loader log', async () => {
    const realAppend = Node.prototype.appendChild;
    vi.spyOn(Node.prototype, 'appendChild').mockImplementation(function (this: Node, node: Node) {
      if (node instanceof HTMLScriptElement && /flag\.min\.js/.test(node.src || '')) return node;
      return realAppend.call(this, node);
    });
    localStorage.setItem(SESSION_KEY, serializeSession(createSession('debug')));
    await bootAs(loaderTag());
    expect(joined(logs)).toBe('');
    expect(joined(warns)).toBe('');
    console.error('debug-busy-marker');
    const texts = await cardTexts();
    expect(texts).toContain('Error: debug-busy-marker');
  });

  it('drops a console.error raised while another console error is being recorded', async () => {
    startSession('my-project.sp');
    await boot();
    const box: Record<string, string> = {};
    Object.defineProperty(box, 'boom', {
      enumerable: true,
      get() {
        console.error('nested-marker');
        return 'x';
      },
    });
    console.error(box);
    const texts = await cardTexts();
    expect(texts).toContain('Error: {boom: "x"}');
    expect(texts.join('\n')).not.toContain('nested-marker');
  });

  it('ignores beforescriptexecute when the target has no matches method', async () => {
    Object.defineProperty(Document.prototype, 'onbeforescriptexecute', {
      configurable: true,
      writable: true,
      value: null,
    });
    startSession('my-project.sp');
    await bootAs(loaderTag({ 'data-stagepass-live-src': 'true' }));
    const text = document.createTextNode('plain');
    document.body.appendChild(text);
    const event = new Event('beforescriptexecute', { cancelable: true, bubbles: true });
    const errors: unknown[] = [];
    const onError = (e: ErrorEvent) => errors.push(e.error);
    window.addEventListener('error', onError);
    try {
      expect(() => text.dispatchEvent(event)).not.toThrow();
    } finally {
      window.removeEventListener('error', onError);
    }
    expect(errors).toEqual([]);
    expect(event.defaultPrevented).toBe(false);
  });

  it('reports a failed local file when fetch is missing', async () => {
    startSession('my-project.sp');
    document.body.innerHTML = '<script data-stagepass data-src="https://cdn.example.com/js/main.js"></script>';
    vi.stubGlobal('fetch', undefined);
    await boot();
    await import('../flag-entry.js');
    await flush();
    const el = document.querySelector('script[src*="my-project.sp/main.js"]') as HTMLScriptElement;
    el.dispatchEvent(new Event('error'));
    await flush();
    const root = document.getElementById('stagepass-flag')!.shadowRoot as ShadowRoot;
    const pill = root.querySelector('button') as HTMLButtonElement;
    pill.dispatchEvent(Object.assign(new Event('pointerenter', { bubbles: true }), { pointerType: 'mouse' }));
    await import('../flag-card-entry.js');
    pill.click();
    expect(root.querySelector('[role=dialog]')!.textContent).toContain('Failed to load main.js');
  });
});
