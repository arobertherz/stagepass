import { test, expect } from '@playwright/test';
import { gotoPage, installRoutes } from '../helpers/serve.js';

test.describe('zero-cost live-src', () => {
  test('(a) no session: production assets run, no flag/local requests, no console errors', async ({
    page,
  }) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('console', (msg) => {
      if (msg.type() === 'error') errors.push(msg.text());
    });

    const { requests } = await installRoutes(page);
    await gotoPage(page, 'live-src.html');

    await expect(page.locator('#ok')).toHaveText('live-src');
    const state = await page.evaluate(() => ({
      order: (window as any).__order,
      prodA: (window as any).__prod_a,
      prodB: (window as any).__prod_b,
      localA: (window as any).__local_a,
      localB: (window as any).__local_b,
      sheet: getComputedStyle(document.documentElement).getPropertyValue('--sp-sheet').trim(),
      integrity: Array.from(document.querySelectorAll('[data-stagepass]')).map((el) =>
        el.getAttribute('integrity')
      ),
    }));

    expect(state.order).toEqual(['prod-a', 'prod-b']);
    expect(state.prodA).toBe(true);
    expect(state.prodB).toBe(true);
    expect(state.localA).toBeUndefined();
    expect(state.localB).toBeUndefined();
    expect(state.sheet).toBe('prod');
    expect(state.integrity.every(Boolean)).toBe(true);

    const extra = requests.filter(
      (u) =>
        u.includes('flag.min.js') ||
        u.includes('flag-card.min.js') ||
        u.includes('.sp/')
    );
    expect(extra).toEqual([]);
    expect(errors).toEqual([]);
  });

  test('(b) session: local assets run in order, production does not, integrity removed', async ({
    page,
  }) => {
    const { requests } = await installRoutes(page);
    await gotoPage(page, 'live-src.html', { session: 'demo.sp' });

    await expect.poll(async () => page.evaluate(() => (window as any).__order)).toEqual([
      'local-a',
      'local-b',
    ]);

    const state = await page.evaluate(() => ({
      order: (window as any).__order,
      prodA: (window as any).__prod_a,
      prodB: (window as any).__prod_b,
      localA: (window as any).__local_a,
      localB: (window as any).__local_b,
      sheet: getComputedStyle(document.documentElement).getPropertyValue('--sp-sheet').trim(),
      scripts: Array.from(document.querySelectorAll('script[data-stagepass]')).map((el) => ({
        src: (el as HTMLScriptElement).src,
        integrity: el.getAttribute('integrity'),
      })),
      link: (() => {
        const el = document.querySelector('link[data-stagepass]') as HTMLLinkElement;
        return { href: el.href, integrity: el.getAttribute('integrity') };
      })(),
    }));

    expect(state.order).toEqual(['local-a', 'local-b']);
    expect(state.localA).toBe(true);
    expect(state.localB).toBe(true);
    expect(state.prodA).toBeUndefined();
    expect(state.prodB).toBeUndefined();
    expect(state.sheet).toBe('local');
    expect(state.scripts.every((s) => s.src.includes('https://demo.sp/') && !s.integrity)).toBe(
      true
    );
    expect(state.link.href).toMatch(/^https:\/\/demo\.sp\/main\.css/);
    expect(state.link.integrity).toBeNull();

    expect(requests.some((u) => u.includes('flag.min.js'))).toBe(true);
    expect(requests.some((u) => u.includes('https://demo.sp/'))).toBe(true);
  });
});
