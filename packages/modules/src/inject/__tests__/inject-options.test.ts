import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

describe('Inject options (integrity, nonce, allowlist)', () => {
  beforeAll(async () => {
    const stagepassObj: any = {
      vars: {
        isLocal: false,
        env: 'production',
        domain: 'example.com',
        timestamp: 0,
        version: '2.0.0',
      },
      warn: vi.fn(),
      resolveLocalUrl: () => '',
      use: (_name: string, _version: string, factory: (api: any) => void) => {
        factory(stagepassObj);
        return true;
      },
    };
    (window as any).stagepass = stagepassObj;
    (globalThis as any).stagepass = stagepassObj;
    await import('../index.ts');
  });

  beforeEach(() => {
    document.head.innerHTML = '';
    document.body.innerHTML = '';
    ((window as any).stagepass.warn as ReturnType<typeof vi.fn>).mockClear();
  });

  it('passes integrity, crossorigin, and nonce through', async () => {
    const inject = (window as any).stagepass.inject;
    // Do not await: jsdom will not load the remote script; attributes are set sync
    void inject({
      src: 'https://cdn.example.com/lib.js',
      integrity: 'sha384-test',
      crossorigin: 'anonymous',
      nonce: 'abc123',
      allowedHosts: ['cdn.example.com'],
      position: 'head',
    });
    const el = document.querySelector(
      'script[src="https://cdn.example.com/lib.js"]'
    ) as HTMLScriptElement;
    expect(el).toBeTruthy();
    expect(el.getAttribute('integrity')).toBe('sha384-test');
    expect(el.getAttribute('crossorigin')).toBe('anonymous');
    expect(el.getAttribute('nonce')).toBe('abc123');
  });

  it('rejects disallowed hosts with a warning and skips inject', async () => {
    const sp = (window as any).stagepass;
    await sp.inject({
      src: 'https://evil.example/x.js',
      allowedHosts: ['cdn.example.com'],
      position: 'head',
    });
    expect(document.querySelector('script[src="https://evil.example/x.js"]')).toBeNull();
    expect(sp.warn).toHaveBeenCalled();
  });

  it('does not let attributes override src after allowlist check', () => {
    const inject = (window as any).stagepass.inject;
    void inject({
      src: 'https://cdn.example.com/lib.js',
      allowedHosts: ['cdn.example.com'],
      attributes: { src: 'https://evil.example/x.js' },
      position: 'head',
    });
    expect(document.querySelector('script[src="https://evil.example/x.js"]')).toBeNull();
    const el = document.querySelector(
      'script[src="https://cdn.example.com/lib.js"]'
    ) as HTMLScriptElement;
    expect(el).toBeTruthy();
  });
});

describe('Inject without loader', () => {
  it('warns and still attaches inject API (2.0.0 compatible)', async () => {
    vi.resetModules();
    delete (window as any).stagepass;
    delete (globalThis as any).stagepass;
    delete (window as any).sp;
    delete (globalThis as any).sp;
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await import('../index.ts');
    expect(warn).toHaveBeenCalled();
    expect(typeof (window as any).stagepass.inject).toBe('function');
    warn.mockRestore();
  });
});

describe('Inject INV-6 / F-2 localhost without session', () => {
  beforeAll(async () => {
    vi.resetModules();
    const stagepassObj: any = {
      vars: {
        isLocal: true,
        env: 'local',
        domain: 'localhost',
        timestamp: 999001,
        version: '2.2.1',
      },
      warn: vi.fn(),
      resolveLocalUrl: () => '',
      use: (_name: string, _version: string, factory: (api: any) => void) => {
        factory(stagepassObj);
        return true;
      },
    };
    (window as any).stagepass = stagepassObj;
    (globalThis as any).stagepass = stagepassObj;
    await import('../index.ts');
  });

  beforeEach(() => {
    document.head.innerHTML = '';
    document.body.innerHTML = '';
  });

  it('INV-6 / F-2: page on localhost, empty resolveLocalUrl → production src unchanged (no ?_cb=)', () => {
    const inject = (window as any).stagepass.inject;
    // Do not await: jsdom will not load the remote script; attributes are set sync
    void inject({
      src: 'https://cdn.example.com/app.js',
      position: 'head',
    });
    const el = document.querySelector(
      'script[src="https://cdn.example.com/app.js"]'
    ) as HTMLScriptElement;
    expect(el).toBeTruthy();
    expect(document.querySelector('script[src*="_cb="]')).toBeNull();
    expect(document.querySelector('script[src*="localhost"]')).toBeNull();
  });

  it('INV-6 / F-2: empty resolveLocalUrl still applies version ?v= on production src', () => {
    const inject = (window as any).stagepass.inject;
    void inject({
      src: 'https://cdn.example.com/app.js',
      version: '2.2.1',
      position: 'head',
    });
    const el = document.querySelector(
      'script[src="https://cdn.example.com/app.js?v=2.2.1"]'
    ) as HTMLScriptElement;
    expect(el).toBeTruthy();
    expect(document.querySelector('script[src*="_cb="]')).toBeNull();
  });
});
