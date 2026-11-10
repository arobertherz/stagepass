import { beforeEach, describe, expect, it, vi } from 'vitest';

async function loadMaintenance(sp: any) {
  vi.resetModules();
  (window as any).stagepass = sp;
  (globalThis as any).stagepass = sp;
  (window as any).sp = sp;
  (globalThis as any).sp = sp;
  await import('../index.ts');
}

describe('Maintenance module', () => {
  beforeEach(() => {
    document.head.innerHTML = '';
    document.body.innerHTML = '';
    localStorage.clear();
    delete (window as any).stagepass;
    delete (globalThis as any).stagepass;
    delete (window as any).sp;
    delete (globalThis as any).sp;
    Object.defineProperty(document, 'currentScript', {
      configurable: true,
      get: () => null,
    });
  });

  it('registers enable/disable/isActive and shows overlay for visitors', async () => {
    const stagepassObj: any = {
      vars: { isLocal: false, env: 'production', domain: 'example.com', timestamp: 0, version: '2.0.0' },
      is: () => false,
      use: (_n: string, _v: string, factory: (api: any) => void) => {
        factory(stagepassObj);
        return true;
      },
    };
    await loadMaintenance(stagepassObj);

    expect(stagepassObj.maintenance.isActive()).toBe(false);
    stagepassObj.maintenance.enable({
      title: 'We will be back soon',
      text: 'Maintenance in progress',
    });
    expect(stagepassObj.maintenance.isActive()).toBe(true);

    const overlay = document.getElementById('stagepass-maintenance-overlay');
    expect(overlay).toBeTruthy();
    expect(overlay?.getAttribute('role')).toBe('alertdialog');
    expect(overlay?.textContent).toContain('We will be back soon');
    expect(overlay?.textContent).toContain('Maintenance in progress');
    expect(overlay?.innerHTML).not.toMatch(/<script/i);

    stagepassObj.maintenance.disable();
    expect(document.getElementById('stagepass-maintenance-overlay')).toBeNull();
    expect(stagepassObj.maintenance.isActive()).toBe(false);
  });

  it('shows a badge instead of overlay when a developer session is active', async () => {
    localStorage.setItem(
      'stagepass_domain',
      JSON.stringify({ domain: 'my-project.sp', expires: Date.now() + 1e8 })
    );
    const stagepassObj: any = {
      vars: { isLocal: true, env: 'local', domain: 'my-project.sp', timestamp: 1, version: '2.0.0' },
      is: (n: string) => n === 'local',
      use: (_n: string, _v: string, factory: (api: any) => void) => {
        factory(stagepassObj);
        return true;
      },
    };
    await loadMaintenance(stagepassObj);
    stagepassObj.maintenance.enable({ title: 'Offline' });
    expect(document.getElementById('stagepass-maintenance-overlay')).toBeNull();
    const badge = document.getElementById('stagepass-maintenance-badge');
    expect(badge).toBeTruthy();
    expect(badge?.textContent).toContain('Offline');
  });

  it('auto-enables only when data-stagepass-maintenance="true"', async () => {
    const script = document.createElement('script');
    script.src = 'https://cdn.jsdelivr.net/npm/@stagepass/modules@2/dist/maintenance.min.js';
    script.setAttribute('data-stagepass-maintenance', 'true');
    script.setAttribute('data-stagepass-maintenance-title', 'Closed');
    script.setAttribute('data-stagepass-maintenance-text', 'Try later');
    document.head.appendChild(script);
    Object.defineProperty(document, 'currentScript', {
      configurable: true,
      get: () => script,
    });

    const stagepassObj: any = {
      vars: { isLocal: false, env: 'production', domain: 'example.com', timestamp: 0, version: '2.0.0' },
      is: () => false,
      use: (_n: string, _v: string, factory: (api: any) => void) => {
        factory(stagepassObj);
        return true;
      },
    };
    await loadMaintenance(stagepassObj);
    expect(stagepassObj.maintenance.isActive()).toBe(true);
    expect(document.getElementById('stagepass-maintenance-overlay')?.textContent).toContain(
      'Closed'
    );
  });

  it('warns without throwing when loader is missing', async () => {
    vi.resetModules();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await import('../index.ts');
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it('enable() without options keeps last title/text; disable() does not reset them', async () => {
    const stagepassObj: any = {
      vars: { isLocal: false, env: 'production', domain: 'example.com', timestamp: 0, version: '2.0.0' },
      is: () => false,
      use: (_n: string, _v: string, factory: (api: any) => void) => {
        factory(stagepassObj);
        return true;
      },
    };
    await loadMaintenance(stagepassObj);

    stagepassObj.maintenance.enable();
    expect(document.getElementById('stagepass-maintenance-title')?.textContent).toBe(
      'We will be back soon'
    );
    expect(document.getElementById('stagepass-maintenance-desc')?.textContent).toBe(
      'This site is temporarily unavailable while we perform maintenance.'
    );

    stagepassObj.maintenance.enable({ title: 'Zwei', text: 'Zwei-Text' });
    expect(document.getElementById('stagepass-maintenance-title')?.textContent).toBe('Zwei');
    expect(document.getElementById('stagepass-maintenance-desc')?.textContent).toBe('Zwei-Text');

    stagepassObj.maintenance.disable();
    expect(document.getElementById('stagepass-maintenance-overlay')).toBeNull();
    expect(stagepassObj.maintenance.isActive()).toBe(false);

    stagepassObj.maintenance.enable();
    expect(stagepassObj.maintenance.isActive()).toBe(true);
    expect(document.getElementById('stagepass-maintenance-title')?.textContent).toBe('Zwei');
    expect(document.getElementById('stagepass-maintenance-desc')?.textContent).toBe('Zwei-Text');
  });
});
