import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

function firePendingScriptLoads(seen: WeakSet<HTMLScriptElement>) {
  for (const script of Array.from(document.querySelectorAll('script[src]'))) {
    const el = script as HTMLScriptElement;
    if (seen.has(el)) continue;
    seen.add(el);
    if (typeof el.onload === 'function') {
      el.onload(new Event('load'));
    } else {
      el.dispatchEvent(new Event('load'));
    }
  }
}

/** jsdom does not fire script onload for remote src; inject waits on it before the next stack entry. */
async function advanceScriptStack(work: Promise<unknown>, steps = 10) {
  const seen = new WeakSet<HTMLScriptElement>();
  for (let i = 0; i < steps; i++) {
    await Promise.resolve();
    firePendingScriptLoads(seen);
  }
  return work;
}


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

  it('AC-10: default scripts have async=false and keep document order', async () => {
    const inject = (window as any).stagepass.inject;
    const done = inject([
      { src: 'https://cdn.example.com/o1.js', id: 'o1' },
      { src: 'https://cdn.example.com/o2.js', id: 'o2' },
      { src: 'https://cdn.example.com/o3.js', id: 'o3' },
    ]);
    await advanceScriptStack(done);
    const els = ['o1', 'o2', 'o3'].map(
      (id) => document.getElementById(id) as HTMLScriptElement
    );
    for (const el of els) {
      expect(el).toBeTruthy();
      expect(el.async).toBe(false);
      expect(el.hasAttribute('async')).toBe(false);
      expect(el.defer).toBe(true);
    }
    expect(els[0].compareDocumentPosition(els[1]) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(els[1].compareDocumentPosition(els[2]) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

    void inject({ src: 'https://cdn.example.com/as.js', id: 'as', async: true });
    const as = document.getElementById('as') as HTMLScriptElement;
    expect(as).toBeTruthy();
    expect(as.async).toBe(true);
  });

  it('AC-17: action before inserts immediately before the target', () => {
    const a = document.createElement('div');
    a.id = 'before-a';
    const b = document.createElement('div');
    b.id = 'before-b';
    document.body.append(a, b);
    const inject = (window as any).stagepass.inject;
    void inject({
      src: 'https://cdn.example.com/before.js',
      id: 'inj-before',
      position: { target: '#before-b', action: 'before' },
    });
    const inj = document.getElementById('inj-before');
    expect(inj).toBeTruthy();
    expect(inj!.nextElementSibling).toBe(b);
    expect(a.nextElementSibling).toBe(inj);
  });

  it('AC-17/INV-8: action after keeps the pre-existing off-by-one', () => {
    const a = document.createElement('div');
    a.id = 'after-a';
    const b = document.createElement('div');
    b.id = 'after-b';
    const c = document.createElement('div');
    c.id = 'after-c';
    document.body.append(a, b, c);
    const inject = (window as any).stagepass.inject;
    void inject({
      src: 'https://cdn.example.com/after.js',
      id: 'inj-after',
      position: { target: '#after-a', action: 'after' },
    });
    const inj = document.getElementById('inj-after');
    expect(inj).toBeTruthy();
    // getInsertionPoint already returns target.nextSibling (#after-b);
    // injectSingle then inserts after that nextSibling → between #after-b and #after-c.
    expect(a.nextElementSibling).toBe(b);
    expect(b.nextElementSibling).toBe(inj);
    expect(inj!.nextElementSibling).toBe(c);
  });

  it('INV-8/INV-7: { scripts, styles } inserts both; falsy script entries are skipped', async () => {
    const inject = (window as any).stagepass.inject;
    const done = inject({
      scripts: [null, { src: 'https://cdn.example.com/m1.js', id: 'm1' }],
      styles: [{ src: 'https://cdn.example.com/m1.css', id: 'm2' }],
    });
    const seen = new WeakSet<HTMLScriptElement>();
    await Promise.resolve();
    firePendingScriptLoads(seen);
    await Promise.resolve();
    expect(document.getElementById('m1')?.tagName).toBe('SCRIPT');
    expect(document.getElementById('m2')?.tagName).toBe('LINK');
    // Do not await: stylesheet waits up to ~5s for link.sheet in jsdom.
    void done.catch(() => {});
  });

  it('AC-9/INV-7: skipped allowedHosts entry does not abort the rest of the stack', async () => {
    const inject = (window as any).stagepass.inject;
    const done = inject([
      { src: 'https://cdn.example.com/s1.js', id: 's1', allowedHosts: ['cdn.example.com'] },
      { src: 'https://evil.example.net/s2.js', id: 's2', allowedHosts: ['cdn.example.com'] },
      { src: 'https://cdn.example.com/s3.js', id: 's3', allowedHosts: ['cdn.example.com'] },
    ]);
    await advanceScriptStack(done);
    expect(document.getElementById('s1')).toBeTruthy();
    expect(document.getElementById('s2')).toBeNull();
    expect(document.getElementById('s3')).toBeTruthy();
    expect((window as any).stagepass.warn).toHaveBeenCalled();
  });

  it('INV-7: error on one entry does not abort the rest; production does not reject the stack', async () => {
    const inject = (window as any).stagepass.inject;
    const done = inject([
      {
        src: 'https://cdn.example.com/e1.js',
        id: 'e1',
        position: { target: '###[bad', action: 'before' },
      },
      { src: 'https://cdn.example.com/e2.js', id: 'e2' },
      {
        src: 'https://cdn.example.com/e3.js',
        id: 'e3',
        position: { target: '#missing-target', action: 'before' },
      },
      { src: 'https://cdn.example.com/e4.js', id: 'e4' },
    ]);
    await expect(advanceScriptStack(done)).resolves.toBeUndefined();
    expect(document.getElementById('e1')).toBeNull();
    expect(document.getElementById('e2')).toBeTruthy();
    // Missing target falls back to body-end; it is not an error.
    expect(document.getElementById('e3')).toBeTruthy();
    expect(document.getElementById('e4')).toBeTruthy();
  });

  it('INV-7: a single-character src is not treated as empty', () => {
    const inject = (window as any).stagepass.inject;
    void inject({ src: 'x', id: 'onechar' });
    const el = document.getElementById('onechar');
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
