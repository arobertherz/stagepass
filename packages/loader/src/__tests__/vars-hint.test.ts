import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createSession, serializeSession, SESSION_KEY } from '../session.js';

async function boot(withFlag = false) {
  vi.resetModules();
  await import('../index.js');
  if (withFlag) await import('../flag-entry.js');
}

describe('vars debug hint', () => {
  let warnSpy: ReturnType<typeof vi.spyOn>;
  let logSpy: ReturnType<typeof vi.spyOn>;

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
    // Keep spy refs: during a session the loader wraps console.warn/error
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  function joined(): string {
    return [...warnSpy.mock.calls, ...logSpy.mock.calls].flat().map(String).join(' ');
  }

  function hintCount(): number {
    return joined().split('Prefer sp.env()/is()/can()/client()/on()').length - 1;
  }

  it('hints once when vars is read in debug mode after the flag chunk loads', async () => {
    localStorage.setItem(SESSION_KEY, serializeSession(createSession('debug')));
    await boot(true);
    const v1 = (window as any).stagepass.vars;
    expect(Object.isFrozen(v1)).toBe(true);
    expect(v1.env).toBeDefined();
    expect(hintCount()).toBe(1);
    void (window as any).stagepass.vars.env;
    void (window as any).stagepass.vars.domain;
    expect(hintCount()).toBe(1);
  });

  it('does not hint on reads before the flag chunk has loaded', async () => {
    localStorage.setItem(SESSION_KEY, serializeSession(createSession('debug')));
    await boot(false);
    void (window as any).stagepass.vars.env;
    expect(hintCount()).toBe(0);
    // Core keeps a plain property (writable), not a getter
    const desc = Object.getOwnPropertyDescriptor((window as any).stagepass, 'vars');
    expect(desc?.get).toBeUndefined();
    expect(desc?.writable).toBe(true);
  });

  it('does not hint when reading vars without debug (swap session)', async () => {
    localStorage.setItem(SESSION_KEY, serializeSession(createSession('my-project.sp')));
    await boot(true);
    void (window as any).stagepass.vars.env;
    expect(hintCount()).toBe(0);
  });

  it('does not hint in production without a session', async () => {
    await boot();
    void (window as any).stagepass.vars.env;
    expect(hintCount()).toBe(0);
  });
});
