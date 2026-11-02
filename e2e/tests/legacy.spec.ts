import { test, expect } from '@playwright/test';
import { gotoPage, installRoutes } from '../helpers/serve.js';

test.describe('legacy data-src / data-href', () => {
  test('(c) no session: production files load via data-src rewrite', async ({ page }) => {
    await installRoutes(page);
    await gotoPage(page, 'legacy.html');

    await expect.poll(async () => page.evaluate(() => (window as any).__order)).toEqual([
      'prod-a',
      'prod-b',
    ]);
    const state = await page.evaluate(() => ({
      order: (window as any).__order,
      prodA: (window as any).__prod_a,
      localA: (window as any).__local_a,
      sheet: getComputedStyle(document.documentElement).getPropertyValue('--sp-sheet').trim(),
      hasDataSrc: !!document.querySelector('script[data-src]'),
    }));
    expect(state.order).toEqual(['prod-a', 'prod-b']);
    expect(state.prodA).toBe(true);
    expect(state.localA).toBeUndefined();
    expect(state.sheet).toBe('prod');
    expect(state.hasDataSrc).toBe(false);
  });

  test('(c) session: local files load in order, same as 2.3.1', async ({ page }) => {
    await installRoutes(page);
    await gotoPage(page, 'legacy.html', { session: 'demo.sp' });

    await expect.poll(async () => page.evaluate(() => (window as any).__order)).toEqual([
      'local-a',
      'local-b',
    ]);
    const state = await page.evaluate(() => ({
      order: (window as any).__order,
      localA: (window as any).__local_a,
      prodA: (window as any).__prod_a,
      sheet: getComputedStyle(document.documentElement).getPropertyValue('--sp-sheet').trim(),
      srcs: Array.from(document.querySelectorAll('script[src*="demo.sp"]')).map(
        (el) => (el as HTMLScriptElement).src
      ),
    }));
    expect(state.order).toEqual(['local-a', 'local-b']);
    expect(state.localA).toBe(true);
    expect(state.prodA).toBeUndefined();
    expect(state.sheet).toBe('local');
    expect(state.srcs.length).toBe(2);
  });
});
