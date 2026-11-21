import { test, expect, type Page } from '@playwright/test';
import { gotoPage, installRoutes } from '../helpers/serve.js';

const PROBE = '__stagepass_test__';

async function arm(page: Page) {
  await installRoutes(page);
  await page.addInitScript(() => {
    const log: { op: string; key: string; area: string }[] = [];
    (window as any).__spStoreLog = log;
    (['setItem', 'removeItem'] as const).forEach((op) => {
      const orig = Storage.prototype[op];
      Storage.prototype[op] = function (this: Storage, key: string, value?: string) {
        let area = 'other';
        try {
          if (this === localStorage) area = 'local';
          else if (this === sessionStorage) area = 'session';
        } catch (_) {}
        log.push({ op, key: String(key), area });
        return orig.apply(this, arguments as unknown as [string, string]);
      };
    });
  });
}

test.describe('lazy storage probe', () => {
  test.beforeEach(async ({ page }) => {
    await arm(page);
  });

  test('ordinary visit never writes a storage probe and leaves storage empty', async ({ page }) => {
    await gotoPage(page, 'legacy.html');
    await expect.poll(async () => page.evaluate(() => (window as any).__order)).toEqual([
      'prod-a',
      'prod-b',
    ]);

    const state = await page.evaluate(() => ({
      local: localStorage.length,
      session: sessionStorage.length,
      flag: !!document.getElementById('stagepass-flag'),
      domain: (window as any).sp.vars.domain,
      log: (window as any).__spStoreLog as { op: string; key: string; area: string }[],
    }));
    expect(state.domain).toBe('site.test');
    expect(state.flag).toBe(false);
    expect(state.local).toBe(0);
    expect(state.session).toBe(0);
    expect(state.log.filter((e) => e.key === PROBE)).toEqual([]);
    expect(state.log).toEqual([]);

    await page.evaluate(() => {
      localStorage.setItem('__hook_check__', '1');
      localStorage.removeItem('__hook_check__');
    });
    const after = await page.evaluate(
      () => (window as any).__spStoreLog as { key: string }[]
    );
    expect(after.map((e) => e.key)).toEqual(['__hook_check__', '__hook_check__']);
  });

  test('preview session starts, survives reload and navigation, and turns off', async ({ page }) => {
    await gotoPage(page, 'legacy.html', { search: '?stagepass=demo.sp' });
    await expect.poll(async () => page.evaluate(() => (window as any).__order)).toEqual([
      'local-a',
      'local-b',
    ]);
    await expect
      .poll(async () => page.evaluate(() => !!document.getElementById('stagepass-flag')))
      .toBe(true);
    await expect.poll(() => page.url()).toBe('https://site.test/legacy.html');

    const started = await page.evaluate(() => ({
      domain: (window as any).sp.vars.domain,
      env: (window as any).sp.env(),
      raw: localStorage.getItem('stagepass_domain'),
      log: (window as any).__spStoreLog as { op: string; key: string }[],
    }));
    expect(started.domain).toBe('demo.sp');
    expect(started.env).toBe('local');
    expect(JSON.parse(started.raw as string).domain).toBe('demo.sp');
    expect(started.log.filter((e) => e.key === PROBE)).toEqual([]);
    expect(started.log.filter((e) => e.op === 'setItem').map((e) => e.key)).toEqual([
      'stagepass_domain',
    ]);

    await page.reload({ waitUntil: 'load' });
    await expect.poll(async () => page.evaluate(() => (window as any).__order)).toEqual([
      'local-a',
      'local-b',
    ]);
    const reloaded = await page.evaluate(() => ({
      domain: (window as any).sp.vars.domain,
      raw: localStorage.getItem('stagepass_domain'),
      log: (window as any).__spStoreLog as { key: string }[],
    }));
    expect(reloaded.domain).toBe('demo.sp');
    expect(JSON.parse(reloaded.raw as string).domain).toBe('demo.sp');
    expect(reloaded.log.filter((e) => e.key === PROBE)).toEqual([]);

    await page.goto('https://site.test/live-src.html', { waitUntil: 'load' });
    await expect.poll(async () => page.evaluate(() => (window as any).__order)).toEqual([
      'local-a',
      'local-b',
    ]);
    const navigated = await page.evaluate(() => ({
      domain: (window as any).sp.vars.domain,
      search: location.search,
      log: (window as any).__spStoreLog as { key: string }[],
    }));
    expect(navigated.domain).toBe('demo.sp');
    expect(navigated.search).toBe('');
    expect(navigated.log.filter((e) => e.key === PROBE)).toEqual([]);

    await page.goto('https://site.test/legacy.html?stagepass=off', { waitUntil: 'load' });
    await expect.poll(async () => page.evaluate(() => (window as any).__order)).toEqual([
      'prod-a',
      'prod-b',
    ]);
    await expect.poll(() => page.url()).toBe('https://site.test/legacy.html');
    const off = await page.evaluate(() => ({
      domain: (window as any).sp.vars.domain,
      env: (window as any).sp.env(),
      raw: localStorage.getItem('stagepass_domain'),
      flag: !!document.getElementById('stagepass-flag'),
      log: (window as any).__spStoreLog as { op: string; key: string }[],
    }));
    expect(off.raw).toBeNull();
    expect(off.domain).toBe('site.test');
    expect(off.env).toBe('production');
    expect(off.flag).toBe(false);
    expect(off.log.filter((e) => e.key === PROBE)).toEqual([]);
    expect(off.log.some((e) => e.op === 'removeItem' && e.key === 'stagepass_domain')).toBe(true);
  });
});
