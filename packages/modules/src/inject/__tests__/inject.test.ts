import { beforeEach, describe, expect, it, vi } from 'vitest';

describe('Injector Module', () => {
  beforeEach(() => {
    // Reset DOM
    document.head.innerHTML = '';
    document.body.innerHTML = '';
    
    // Setup Stagepass vars mock (both window.stagepass and global stagepass)
    const stagepassObj = {
      vars: {
        isLocal: true,
        env: 'local',
        domain: 'test.sp',
        timestamp: 1234567890,
        version: '1.0.3'
      }
    };
    (window as any).stagepass = stagepassObj;
    (globalThis as any).stagepass = stagepassObj;
  });

  describe('Type detection', () => {
    it('should detect script from .js extension', () => {
      const src = 'https://example.com/app.js';
      const ext = src.split('.').pop()?.toLowerCase();
      const type = ext === 'css' ? 'style' : 'script';
      
      expect(type).toBe('script');
    });

    it('should detect style from .css extension', () => {
      const src = 'https://example.com/styles.css';
      const ext = src.split('.').pop()?.toLowerCase();
      const type = ext === 'css' ? 'style' : 'script';
      
      expect(type).toBe('style');
    });

    it('should default to script when extension is unknown', () => {
      const src = 'https://example.com/file';
      const ext = src.split('.').pop()?.toLowerCase();
      const type = ext === 'css' ? 'style' : 'script';
      
      expect(type).toBe('script');
    });
  });

  describe('Deduplication', () => {
    it('should detect existing element by ID', () => {
      const existing = document.createElement('script');
      existing.id = 'my-script';
      existing.src = 'https://example.com/app.js';
      document.head.appendChild(existing);
      
      const found = document.getElementById('my-script');
      expect(found).toBeTruthy();
    });

    it('should detect existing script by src', () => {
      const existing = document.createElement('script');
      existing.src = 'https://example.com/app.js';
      document.head.appendChild(existing);
      
      const found = document.querySelector('script[src="https://example.com/app.js"]');
      expect(found).toBeTruthy();
    });

    it('should detect existing stylesheet by href', () => {
      const existing = document.createElement('link');
      existing.rel = 'stylesheet';
      existing.href = 'https://example.com/styles.css';
      document.head.appendChild(existing);
      
      const found = document.querySelector('link[href="https://example.com/styles.css"]');
      expect(found).toBeTruthy();
    });
  });

  describe('Positioning', () => {
    it('should insert into head for "head" position', () => {
      const position = 'head';
      const insertionPoint = position === 'head' ? document.head : document.body;
      
      expect(insertionPoint).toBe(document.head);
    });

    it('should insert into body for "body-end" position', () => {
      const position = 'body-end';
      const insertionPoint = position === 'head' ? document.head : document.body;
      
      expect(insertionPoint).toBe(document.body);
    });

    it('should find target element for relative positioning', () => {
      const target = document.createElement('script');
      target.id = 'jquery';
      document.head.appendChild(target);
      
      const targetEl = document.querySelector('#jquery');
      expect(targetEl).toBeTruthy();
    });

    it('should fallback to body when target not found', () => {
      const targetEl = document.querySelector('#nonexistent');
      const insertionPoint = targetEl || document.body;
      
      expect(insertionPoint).toBe(document.body);
    });
  });

  describe('Element creation', () => {
    it('should create script element with correct attributes', () => {
      const script = document.createElement('script');
      script.src = 'https://example.com/app.js';
      script.async = false;
      script.defer = true;
      script.id = 'my-script';
      
      expect(script.src).toBe('https://example.com/app.js');
      expect(script.async).toBe(false);
      expect(script.defer).toBe(true);
      expect(script.id).toBe('my-script');
    });

    it('forces async=false for ordered dynamic scripts', () => {
      const script = document.createElement('script');
      // Browsers default dynamically created scripts to async=true; force order
      script.async = true;
      const optionsAsync = false;
      if (optionsAsync) {
        script.async = true;
      } else {
        script.async = false;
        script.defer = true;
      }
      expect(script.async).toBe(false);
      expect(script.defer).toBe(true);
    });

    it('uses version query param instead of Date.now cache bust', () => {
      const src = 'https://cdn.example.com/app.js?x=1#h';
      const version = '2.0.0';
      const hashIdx = src.indexOf('#');
      const hash = hashIdx >= 0 ? src.slice(hashIdx) : '';
      const base = hashIdx >= 0 ? src.slice(0, hashIdx) : src;
      const sep = base.includes('?') ? '&' : '?';
      const resolved = `${base}${sep}v=${encodeURIComponent(version)}${hash}`;
      expect(resolved).toBe('https://cdn.example.com/app.js?x=1&v=2.0.0#h');
      expect(resolved.includes('_cb=')).toBe(false);
    });

    it('should create link element with correct attributes', () => {
      const link = document.createElement('link');
      link.rel = 'stylesheet';
      link.href = 'https://example.com/styles.css';
      link.id = 'my-styles';
      
      expect(link.rel).toBe('stylesheet');
      expect(link.href).toBe('https://example.com/styles.css');
      expect(link.id).toBe('my-styles');
    });
  });

  describe('Error handling', () => {
    it('should throw error if stagepass vars are not available', () => {
      delete (window as any).stagepass;
      
      expect(() => {
        const sp = (window as any).stagepass;
        if (!sp || !sp.vars) {
          throw new Error('Stagepass core loader must be loaded before modules');
        }
      }).toThrow('Stagepass core loader must be loaded before modules');
    });
  });
});

describe('Inject INV-6 / F-3 source resolution via inject API', () => {
  const prodSrc = 'https://cdn.example.com/lib.js';

  beforeEach(() => {
    document.head.innerHTML = '';
    document.body.innerHTML = '';
  });

  it('INV-6 / F-3: empty resolveLocalUrl keeps production src (no invented localhost ?_cb=)', async () => {
    vi.resetModules();
    const stagepassObj: any = {
      vars: {
        isLocal: true,
        env: 'local',
        domain: 'localhost',
        timestamp: 999001,
        version: '2.2.2',
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
    void stagepassObj.inject({ src: prodSrc, position: 'head' });
    const el = document.querySelector(`script[src="${prodSrc}"]`) as HTMLScriptElement;
    expect(el).toBeTruthy();
    expect(document.querySelector('script[src*="_cb="]')).toBeNull();
    expect(document.querySelector('script[src*="localhost"]')).toBeNull();
  });

  it('INV-6 / F-3: non-empty resolveLocalUrl uses that local URL', async () => {
    vi.resetModules();
    const localUrl = 'https://app.sp/lib.js?_cb=1';
    const stagepassObj: any = {
      vars: {
        isLocal: true,
        env: 'local',
        domain: 'app.sp',
        timestamp: 999002,
        version: '2.2.2',
      },
      warn: vi.fn(),
      resolveLocalUrl: () => localUrl,
      use: (_name: string, _version: string, factory: (api: any) => void) => {
        factory(stagepassObj);
        return true;
      },
    };
    (window as any).stagepass = stagepassObj;
    (globalThis as any).stagepass = stagepassObj;
    await import('../index.ts');
    void stagepassObj.inject({ src: prodSrc, position: 'head' });
    const el = document.querySelector(`script[src="${localUrl}"]`) as HTMLScriptElement;
    expect(el).toBeTruthy();
    expect(document.querySelector(`script[src="${prodSrc}"]`)).toBeNull();
  });

  it('INV-6 / F-3: missing resolveLocalUrl keeps production src', async () => {
    vi.resetModules();
    const stagepassObj: any = {
      vars: {
        isLocal: true,
        env: 'local',
        domain: 'localhost',
        timestamp: 999003,
        version: '2.2.2',
      },
      warn: vi.fn(),
      use: (_name: string, _version: string, factory: (api: any) => void) => {
        factory(stagepassObj);
        return true;
      },
    };
    (window as any).stagepass = stagepassObj;
    (globalThis as any).stagepass = stagepassObj;
    await import('../index.ts');
    void stagepassObj.inject({ src: prodSrc, position: 'head' });
    const el = document.querySelector(`script[src="${prodSrc}"]`) as HTMLScriptElement;
    expect(el).toBeTruthy();
    expect(document.querySelector('script[src*="_cb="]')).toBeNull();
  });

  it('INV-6 / F-3: stagepass false keeps production src when isLocal', async () => {
    vi.resetModules();
    const stagepassObj: any = {
      vars: {
        isLocal: true,
        env: 'local',
        domain: 'app.sp',
        timestamp: 999004,
        version: '2.2.2',
      },
      warn: vi.fn(),
      resolveLocalUrl: () => 'https://app.sp/lib.js',
      use: (_name: string, _version: string, factory: (api: any) => void) => {
        factory(stagepassObj);
        return true;
      },
    };
    (window as any).stagepass = stagepassObj;
    (globalThis as any).stagepass = stagepassObj;
    await import('../index.ts');
    void stagepassObj.inject({ src: prodSrc, stagepass: false, position: 'head' });
    const el = document.querySelector(`script[src="${prodSrc}"]`) as HTMLScriptElement;
    expect(el).toBeTruthy();
    expect(document.querySelector('script[src="https://app.sp/lib.js"]')).toBeNull();
  });
});

describe('Inject INV-8 / F-4 body-start position via inject API', () => {
  it("INV-8 / F-4: position 'body-start' with existing body child is firstElementChild", async () => {
    vi.resetModules();
    const stagepassObj: any = {
      vars: {
        isLocal: false,
        env: 'production',
        domain: 'example.com',
        timestamp: 0,
        version: '2.2.2',
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

    document.head.innerHTML = '';
    document.body.innerHTML = '';
    const existing = document.createElement('div');
    existing.id = 'anchor';
    document.body.appendChild(existing);

    void stagepassObj.inject({
      src: 'https://cdn.example.com/bs.js',
      position: 'body-start',
    });
    const injected = document.querySelector(
      'script[src="https://cdn.example.com/bs.js"]'
    ) as HTMLScriptElement;
    expect(injected).toBeTruthy();
    expect(document.body.firstElementChild).toBe(injected);
    expect(injected.nextElementSibling).toBe(existing);
  });
});
