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
    cookies.bake('profile', { plan: 'pro', id: 7 }, { json: true, path: '/' });
    expect(cookies.eat('profile', { json: true })).toEqual({ plan: 'pro', id: 7 });
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
});

describe('Cookies Module without loader', () => {
  it('warns instead of throwing when loader is absent', async () => {
    vi.resetModules();
    delete (window as any).stagepass;
    delete (globalThis as any).stagepass;
    delete (window as any).sp;
    delete (globalThis as any).sp;
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await import('../index.ts');
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});
