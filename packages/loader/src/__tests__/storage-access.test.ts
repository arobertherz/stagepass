import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const PROBE = '__stagepass_test__';
const KEY = 'stagepass_domain';

type Op = 'getItem' | 'setItem' | 'removeItem';
type Area = 'local' | 'session' | 'other';
type StoreEvent = { op: Op; area: Area; key: string; value?: string };

function areaOf(storage: Storage): Area {
  try {
    if (storage === localStorage) return 'local';
    if (storage === sessionStorage) return 'session';
  } catch (_) {}
  return 'other';
}

function trackStorage() {
  const events: StoreEvent[] = [];
  const originals = {
    getItem: Storage.prototype.getItem,
    setItem: Storage.prototype.setItem,
    removeItem: Storage.prototype.removeItem,
  };
  vi.spyOn(Storage.prototype, 'getItem').mockImplementation(function (this: Storage, key: string) {
    events.push({ op: 'getItem', area: areaOf(this), key: String(key) });
    return originals.getItem.call(this, key);
  });
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (
    this: Storage,
    key: string,
    value: string
  ) {
    events.push({ op: 'setItem', area: areaOf(this), key: String(key), value: String(value) });
    return originals.setItem.call(this, key, value);
  });
  vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(function (this: Storage, key: string) {
    events.push({ op: 'removeItem', area: areaOf(this), key: String(key) });
    return originals.removeItem.call(this, key);
  });
  const of = (op: Op, area: Area) => events.filter((e) => e.op === op && e.area === area);
  const probes = (area: Area) => events.filter((e) => e.area === area && e.key === PROBE);
  return { events, of, probes };
}

function setLocation(search = '', extra: { pathname?: string; hash?: string } = {}) {
  const pathname = extra.pathname ?? '/';
  const hash = extra.hash ?? '';
  vi.stubGlobal('location', {
    hostname: 'www.example.com',
    href: `https://www.example.com${pathname}${search}${hash}`,
    search,
    pathname,
    hash,
    reload: vi.fn(),
  });
}

function sessionRaw(domain: string, expires = Date.now() + 3_600_000) {
  return JSON.stringify({ domain, expires });
}

async function boot() {
  vi.resetModules();
  await import('../index.js');
}

function sp() {
  return (window as any).sp;
}

describe('storage access (#155)', () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    document.head.innerHTML = '';
    document.body.innerHTML = '';
    delete (window as any).stagepass;
    delete (window as any).sp;
    setLocation('');
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('does not write storage on an ordinary visit and reads the session key once', async () => {
    const track = trackStorage();
    await boot();
    expect(sp().vars.domain).toBe('www.example.com');
    expect(sp().env()).toBe('production');
    expect(track.of('getItem', 'local').map((e) => e.key)).toEqual([KEY]);
    expect(track.of('getItem', 'session')).toEqual([]);
    expect(track.of('setItem', 'local')).toEqual([]);
    expect(track.of('setItem', 'session')).toEqual([]);
    expect(track.of('removeItem', 'local')).toEqual([]);
    expect(track.of('removeItem', 'session')).toEqual([]);
    expect(localStorage.length + sessionStorage.length).toBe(0);
  });

  it('starts a preview session from ?stagepass= and cleans the URL without probing', async () => {
    setLocation('?stagepass=foo.sp&keep=1', { pathname: '/docs', hash: '#top' });
    const track = trackStorage();
    const replace = vi.spyOn(history, 'replaceState').mockImplementation(() => {});
    await boot();
    const writes = track.of('setItem', 'local');
    expect(writes.map((e) => e.key)).toEqual([KEY]);
    const record = JSON.parse(writes[0].value as string);
    expect(record.domain).toBe('foo.sp');
    expect(record.expires).toBeGreaterThan(Date.now());
    expect(track.of('getItem', 'local').map((e) => e.key)).toEqual([KEY]);
    expect(track.of('removeItem', 'local')).toEqual([]);
    expect(track.of('setItem', 'session')).toEqual([]);
    expect(track.of('removeItem', 'session')).toEqual([]);
    expect(track.probes('local')).toEqual([]);
    expect(track.probes('session')).toEqual([]);
    expect(sp().vars.domain).toBe('foo.sp');
    expect(sp().env()).toBe('local');
    expect(String(replace.mock.calls[0][2])).toBe('/docs?keep=1#top');
  });

  it('starts debug mode without a storage probe', async () => {
    setLocation('?stagepass=debug');
    const track = trackStorage();
    const replace = vi.spyOn(history, 'replaceState').mockImplementation(() => {});
    await boot();
    const writes = track.of('setItem', 'local');
    expect(writes.map((e) => e.key)).toEqual([KEY]);
    expect(JSON.parse(writes[0].value as string).domain).toBe('debug');
    expect(track.probes('local')).toEqual([]);
    expect(track.probes('session')).toEqual([]);
    expect(sp().vars.domain).toBe('www.example.com');
    expect(String(replace.mock.calls[0][2])).not.toContain('stagepass');
  });

  it('restores a valid session key without writing or probing', async () => {
    localStorage.setItem(KEY, sessionRaw('foo.sp'));
    const track = trackStorage();
    await boot();
    expect(track.of('getItem', 'local').map((e) => e.key)).toEqual([KEY]);
    expect(track.of('setItem', 'local')).toEqual([]);
    expect(track.of('removeItem', 'local')).toEqual([]);
    expect(track.of('setItem', 'session')).toEqual([]);
    expect(track.of('removeItem', 'session')).toEqual([]);
    expect(sp().vars.domain).toBe('foo.sp');
    expect(sp().env()).toBe('local');
    expect(sp().is('local')).toBe(true);
    expect(sp().can('localStorage')).toBe(true);
    expect(track.probes('local').map((e) => e.op)).toEqual(['setItem', 'removeItem']);
    expect(track.probes('session')).toEqual([]);
  });

  it.each(['off', '0', 'false'])('?stagepass=%s removes the session key', async (flag) => {
    localStorage.setItem(KEY, sessionRaw('foo.sp'));
    setLocation(`?stagepass=${flag}`);
    const track = trackStorage();
    const replace = vi.spyOn(history, 'replaceState').mockImplementation(() => {});
    await boot();
    expect(track.of('getItem', 'local').map((e) => e.key)).toEqual([KEY]);
    expect(track.of('removeItem', 'local').map((e) => e.key)).toEqual([KEY]);
    expect(track.of('setItem', 'local')).toEqual([]);
    expect(track.probes('local')).toEqual([]);
    expect(track.probes('session')).toEqual([]);
    expect(localStorage.getItem(KEY)).toBeNull();
    expect(sp().vars.domain).toBe('www.example.com');
    expect(sp().env()).toBe('production');
    expect(String(replace.mock.calls[0][2])).not.toContain('stagepass');
  });

  it.each([
    ['legacy plain string', 'foo.sp'],
    ['invalid domain', JSON.stringify({ domain: 'evil.com', expires: Date.now() + 60_000 })],
    ['expired session', JSON.stringify({ domain: 'foo.sp', expires: Date.now() - 1000 })],
    ['malformed json', '{'],
  ])('removes a %s session value', async (_label, raw) => {
    localStorage.setItem(KEY, raw);
    const track = trackStorage();
    await boot();
    expect(track.of('getItem', 'local').map((e) => e.key)).toEqual([KEY]);
    expect(track.of('removeItem', 'local').map((e) => e.key)).toEqual([KEY]);
    expect(track.of('setItem', 'local')).toEqual([]);
    expect(track.of('setItem', 'session')).toEqual([]);
    expect(track.of('removeItem', 'session')).toEqual([]);
    expect(localStorage.getItem(KEY)).toBeNull();
    expect(sp().env()).toBe('production');
  });

  it('probes localStorage and sessionStorage lazily, once, and only after the call', async () => {
    const track = trackStorage();
    await boot();
    expect(track.probes('local')).toEqual([]);
    expect(track.probes('session')).toEqual([]);

    expect(Object.keys(sp().vars.client.capabilities).sort()).toEqual([
      'cookiesEnabled',
      'localStorage',
      'sessionStorage',
    ]);
    expect(track.probes('local')).toEqual([]);
    expect(sp().can('cookies')).toEqual(expect.any(Boolean));
    expect(sp().can('serviceWorker')).toEqual(expect.any(Boolean));
    expect(sp().can('nope')).toBe(false);
    expect(track.probes('local')).toEqual([]);
    expect(track.probes('session')).toEqual([]);

    expect(sp().can('localStorage')).toBe(true);
    expect(track.probes('local').map((e) => e.op)).toEqual(['setItem', 'removeItem']);
    expect(track.probes('session')).toEqual([]);

    expect(sp().can('localStorage')).toBe(true);
    expect(sp().vars.client.capabilities.localStorage).toBe(true);
    expect(track.probes('local')).toHaveLength(2);

    expect(sp().vars.client.capabilities.sessionStorage).toBe(true);
    expect(track.probes('session').map((e) => e.op)).toEqual(['setItem', 'removeItem']);
    expect(sp().can('sessionStorage')).toBe(true);
    expect(sp().vars.client.capabilities.sessionStorage).toBe(true);
    expect(track.probes('session')).toHaveLength(2);
    expect(track.probes('local')).toHaveLength(2);
  });

  it('returns false and memoizes when setItem throws', async () => {
    const orig = Storage.prototype.setItem;
    const calls = { local: 0, session: 0 };
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (
      this: Storage,
      key: string,
      value: string
    ) {
      if (key === PROBE) {
        if (this === localStorage) calls.local += 1;
        else if (this === sessionStorage) calls.session += 1;
        throw new Error('quota');
      }
      return orig.call(this, key, value);
    });
    await boot();
    expect(calls).toEqual({ local: 0, session: 0 });
    expect(sp().can('localStorage')).toBe(false);
    expect(sp().can('localStorage')).toBe(false);
    expect(sp().vars.client.capabilities.localStorage).toBe(false);
    expect(calls.local).toBe(1);
    expect(sp().can('sessionStorage')).toBe(false);
    expect(sp().vars.client.capabilities.sessionStorage).toBe(false);
    expect(sp().can('sessionStorage')).toBe(false);
    expect(calls.session).toBe(1);
    expect(calls.local).toBe(1);
  });

  it('returns false and memoizes when storage access throws', async () => {
    const hits = { local: 0, session: 0 };
    const saved = {
      local: Object.getOwnPropertyDescriptor(window, 'localStorage'),
      session: Object.getOwnPropertyDescriptor(window, 'sessionStorage'),
    };
    const block = (name: 'localStorage' | 'sessionStorage') => {
      Object.defineProperty(window, name, {
        configurable: true,
        get() {
          hits[name === 'localStorage' ? 'local' : 'session'] += 1;
          throw new Error('denied');
        },
      });
    };
    block('localStorage');
    block('sessionStorage');
    try {
      await boot();
      const afterBoot = { ...hits };
      expect(afterBoot.local).toBeGreaterThan(0);
      expect(sp().can('localStorage')).toBe(false);
      expect(sp().can('localStorage')).toBe(false);
      expect(sp().vars.client.capabilities.localStorage).toBe(false);
      expect(hits.local).toBe(afterBoot.local + 1);
      expect(sp().can('sessionStorage')).toBe(false);
      expect(sp().vars.client.capabilities.sessionStorage).toBe(false);
      expect(sp().can('sessionStorage')).toBe(false);
      expect(hits.session).toBe(afterBoot.session + 1);
    } finally {
      if (saved.local) Object.defineProperty(window, 'localStorage', saved.local);
      else delete (window as any).localStorage;
      if (saved.session) Object.defineProperty(window, 'sessionStorage', saved.session);
      else delete (window as any).sessionStorage;
    }
  });
});
