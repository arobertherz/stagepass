import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

describe('Cookies Module', () => {
  beforeAll(async () => {
    const stagepassObj = {
      vars: {
        isLocal: true,
        env: 'local',
        domain: 'test.sp',
        timestamp: 1234567890,
        version: '1.1.4',
      },
      warn: vi.fn(),
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
  });

  it('bakes and eats a simple cookie', () => {
    const cookies = (window as any).stagepass.cookies;
    cookies.bake('session', 'abc123', { path: '/' });
    expect(cookies.eat('session')).toBe('abc123');
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
});
