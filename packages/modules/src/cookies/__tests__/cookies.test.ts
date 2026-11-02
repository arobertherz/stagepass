import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

describe('Cookies Module', () => {
  beforeAll(async () => {
    const stagepassObj = {
      vars: {
        isLocal: true,
        env: 'local',
        domain: 'test.sp',
        timestamp: 1234567890,
        version: '2.0.0',
      },
      warn: vi.fn(),
      use: (name: string, version: string, factory: (api: any) => void) => {
        factory(stagepassObj);
        return true;
      },
    };
    (window as any).stagepass = stagepassObj;
    (globalThis as any).stagepass = stagepassObj;
    await import('../index.ts');
  });

  beforeEach(() => {
    const all = document.cookie ? document.cookie.split('; ') : [];
    for (const row of all) {
      const idx = row.indexOf('=');
      const name = idx >= 0 ? row.substring(0, idx) : row;
      document.cookie = `${name}=; Max-Age=0; Path=/`;
    }
    const sp = (window as any).stagepass;
    if (sp.consent) sp.consent.set(() => true);
  });

  it('bakes and eats a simple cookie', () => {
    const cookies = (window as any).stagepass.cookies;
    cookies.bake('session', 'abc123', { path: '/' });
    expect(cookies.eat('session')).toBe('abc123');
  });

  it('exposes singular cookie alias', () => {
    const sp = (window as any).stagepass;
    expect(sp.cookie).toBe(sp.cookies);
  });

  it('supports JSON cookies', () => {
    const cookies = (window as any).stagepass.cookies;
    cookies.bake('profile', { role: 'editor', id: 7 }, { json: true, path: '/' });
    expect(cookies.eat('profile', { json: true })).toEqual({ role: 'editor', id: 7 });
  });

  it('has() reports cookie existence', () => {
    const cookies = (window as any).stagepass.cookies;
    expect(cookies.has('missing')).toBe(false);
    cookies.bake('flag', 'on', { path: '/' });
    expect(cookies.has('flag')).toBe(true);
  });

  it('throw() removes a cookie', () => {
    const cookies = (window as any).stagepass.cookies;
    cookies.bake('token', 'value', { path: '/' });
    expect(cookies.eat('token')).toBe('value');
    cookies.throw('token', { path: '/' });
    expect(cookies.eat('token')).toBeNull();
  });

  it('list() returns all cookies as key/value map', () => {
    const cookies = (window as any).stagepass.cookies;
    cookies.bake('a', '1', { path: '/' });
    cookies.bake('b', '2', { path: '/' });
    const all = cookies.list();
    expect(all.a).toBe('1');
    expect(all.b).toBe('2');
  });

  it('jar() and crumbs() track known cookies', () => {
    const cookies = (window as any).stagepass.cookies;
    cookies.bake('pref_theme', 'dark', { path: '/' });
    cookies.bake('pref_lang', 'en', { path: '/' });
    cookies.bake('other', 'x', { path: '/' });
    expect(cookies.jar()).toMatchObject({
      pref_theme: 'dark',
      pref_lang: 'en',
      other: 'x',
    });
    expect(cookies.crumbs('pref_').sort()).toEqual(['pref_lang', 'pref_theme']);
  });

  it('throwAll({ category }) deletes by category', () => {
    const cookies = (window as any).stagepass.cookies;
    cookies.bake('a', '1', { path: '/', category: 'analytics' });
    cookies.bake('b', '2', { path: '/', category: 'necessary' });
    cookies.throwAll({ category: 'analytics' });
    expect(cookies.eat('a')).toBeNull();
    expect(cookies.eat('b')).toBe('2');
  });

  it('queues categorized bake when consent rejects, then flushes on update', () => {
    const sp = (window as any).stagepass;
    const cookies = sp.cookies;
    sp.consent.set((category: string) => category !== 'marketing');
    cookies.bake('m', 'queued', { path: '/', category: 'marketing' });
    expect(cookies.eat('m')).toBeNull();
    expect(cookies.jar().m).toBe('queued');
    expect(sp.consent.allows('marketing')).toBe(false);

    sp.consent.set(() => true);
    sp.consent.update();
    expect(cookies.eat('m')).toBe('queued');
  });

  it('rejects path/domain values that contain semicolons', () => {
    const cookies = (window as any).stagepass.cookies;
    expect(() => cookies.bake('x', '1', { path: '/; Domain=evil.com' })).toThrow(
      /Invalid cookie path/
    );
    expect(() => cookies.bake('x', '1', { domain: 'evil.com; Secure' })).toThrow(
      /Invalid cookie domain/
    );
  });

  it('rejects unencoded values that contain semicolons', () => {
    const cookies = (window as any).stagepass.cookies;
    expect(() => cookies.bake('x', 'a;b', { encode: false, path: '/' })).toThrow(
      /Invalid cookie value/
    );
  });

  it('on(bake|throw) fires after successful write/delete and supports unsubscribe', () => {
    const cookies = (window as any).stagepass.cookies;
    const baked: unknown[] = [];
    const thrown: unknown[] = [];
    const offBake = cookies.on('bake', (p: unknown) => baked.push(p));
    const offThrow = cookies.on('throw', (p: unknown) => thrown.push(p));

    cookies.bake('ev', '1', { path: '/', category: 'analytics' });
    expect(baked).toEqual([{ name: 'ev', category: 'analytics' }]);
    cookies.throw('ev', { path: '/' });
    expect(thrown).toEqual([{ name: 'ev', category: 'analytics' }]);

    offBake();
    offThrow();
    cookies.bake('ev2', '2', { path: '/' });
    cookies.throw('ev2', { path: '/' });
    expect(baked).toHaveLength(1);
    expect(thrown).toHaveLength(1);
  });

  it('on(bake) fires for queued bake only after consent.update flushes', () => {
    const sp = (window as any).stagepass;
    const cookies = sp.cookies;
    const baked: unknown[] = [];
    cookies.on('bake', (p: unknown) => baked.push(p));
    sp.consent.set((category: string) => category !== 'marketing');
    cookies.bake('m', 'queued', { path: '/', category: 'marketing' });
    expect(baked).toEqual([]);
    sp.consent.set(() => true);
    sp.consent.update();
    expect(baked).toEqual([{ name: 'm', category: 'marketing' }]);
  });

  it('on(throw) fires per cookie for throwAll', () => {
    const cookies = (window as any).stagepass.cookies;
    const thrown: string[] = [];
    cookies.on('throw', (p: { name: string }) => thrown.push(p.name));
    cookies.bake('a', '1', { path: '/', category: 'analytics' });
    cookies.bake('b', '2', { path: '/', category: 'analytics' });
    cookies.throwAll({ category: 'analytics' });
    expect(thrown.sort()).toEqual(['a', 'b']);
  });

  it('listener errors do not break bake/throw', () => {
    const cookies = (window as any).stagepass.cookies;
    cookies.on('bake', () => {
      throw new Error('listener boom');
    });
    cookies.on('throw', () => {
      throw new Error('listener boom');
    });
    expect(() => cookies.bake('ok', '1', { path: '/' })).not.toThrow();
    expect(cookies.eat('ok')).toBe('1');
    expect(() => cookies.throw('ok', { path: '/' })).not.toThrow();
    expect(cookies.eat('ok')).toBeNull();
  });
});

describe('Cookies Module without loader', () => {
  it('warns and still attaches cookies API (2.0.0 compatible)', async () => {
    vi.resetModules();
    delete (window as any).stagepass;
    delete (globalThis as any).stagepass;
    delete (window as any).sp;
    delete (globalThis as any).sp;
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await import('../index.ts');
    expect(warn).toHaveBeenCalled();
    expect(typeof (window as any).stagepass.cookies.bake).toBe('function');
    expect((window as any).stagepass.cookie).toBe((window as any).stagepass.cookies);
    warn.mockRestore();
  });
});
