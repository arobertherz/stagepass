import { defineConfig, devices } from '@playwright/test';

/**
 * Browser E2E for zero-cost / legacy loader behaviour.
 * Run inside mcr.microsoft.com/playwright:v1.56.1-noble (see CONTRIBUTING.md).
 * Fixtures are served via page.route (no real network).
 */
export default defineConfig({
  testDir: './tests',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: 0,
  workers: 2,
  reporter: 'list',
  timeout: 30_000,
  use: {
    trace: 'off',
    video: 'off',
    screenshot: 'off',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'firefox', use: { ...devices['Desktop Firefox'] } },
    { name: 'webkit', use: { ...devices['Desktop Safari'] } },
    // Release Firefox may hide InstallTrigger; the loader must not depend on it.
    {
      name: 'firefox-no-installtrigger',
      use: {
        ...devices['Desktop Firefox'],
        launchOptions: { firefoxUserPrefs: { 'extensions.InstallTrigger.enabled': false } },
      },
    },
  ],
});
