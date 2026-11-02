import { test, expect } from '@playwright/test';
import { gotoPage, installRoutes } from '../helpers/serve.js';

test.describe('flag chunk relative to loader URL', () => {
  test('(d) flag.min.js loads next to the loader script URL', async ({ page }) => {
    const { requests } = await installRoutes(page);
    await gotoPage(page, 'flag-base.html', { session: 'demo.sp' });

    await expect.poll(() => requests.some((u) => u.includes('assets.test/stagepass/flag.min.js'))).toBe(
      true
    );
    expect(requests.some((u) => u.includes('assets.test/stagepass/loader.min.js'))).toBe(true);
    expect(requests.some((u) => u.includes('jsdelivr.net') && u.includes('flag.min.js'))).toBe(
      false
    );
  });
});
