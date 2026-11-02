import { test, expect } from '@playwright/test';
import { gotoPage, installRoutes } from '../helpers/serve.js';

test.describe('live reload chunk', () => {
  test('without session: no live.min.js and no /__stagepass/live request', async ({ page }) => {
    const { requests } = await installRoutes(page, { liveSse: 'css' });
    await gotoPage(page, 'live-src.html');

    await expect(page.locator('#ok')).toHaveText('live-src');
    await page.waitForTimeout(300);

    const liveReqs = requests.filter(
      (u) => u.includes('live.min.js') || u.includes('/__stagepass/live')
    );
    expect(liveReqs).toEqual([]);
  });

  test('with session: CSS event swaps local stylesheet without full reload', async ({ page }) => {
    const { requests } = await installRoutes(page, { liveSse: 'css' });

    let navigations = 0;
    page.on('framenavigated', (frame) => {
      if (frame === page.mainFrame()) navigations++;
    });

    await gotoPage(page, 'live-src.html', { session: 'demo.sp' });

    await expect.poll(async () => page.evaluate(() => (window as any).__order)).toEqual([
      'local-a',
      'local-b',
    ]);

    await expect
      .poll(() => requests.some((u) => u.includes('live.min.js')))
      .toBe(true);
    await expect
      .poll(() => requests.some((u) => u.includes('/__stagepass/live')))
      .toBe(true);

    await expect
      .poll(async () =>
        page.evaluate(() => {
          const el = document.querySelector('link[rel="stylesheet"][data-stagepass]') as HTMLLinkElement | null;
          return el ? el.href : '';
        })
      )
      .toMatch(/[?&]t=\d+/);

    const sheet = await page.evaluate(() =>
      getComputedStyle(document.documentElement).getPropertyValue('--sp-sheet').trim()
    );
    expect(sheet).toBe('local');

    // Initial goto + no extra full reload from the css event
    expect(navigations).toBe(1);
    expect(await page.evaluate(() => (window as any).__local_a)).toBe(true);
  });

  test('with session: reload event triggers a full page reload', async ({ page }) => {
    const { requests } = await installRoutes(page, { liveSse: 'reload' });

    await gotoPage(page, 'live-src.html', { session: 'demo.sp' });

    await expect
      .poll(() => requests.some((u) => u.includes('/__stagepass/live')))
      .toBe(true);

    // EventSource receives reload and calls location.reload(); wait for a second load.
    await page.waitForFunction(() => (window as any).__order?.length >= 2, null, {
      timeout: 10_000,
    });

    // After reload the session still swaps; order is rebuilt.
    await expect.poll(async () => page.evaluate(() => (window as any).__order)).toEqual([
      'local-a',
      'local-b',
    ]);
  });
});
