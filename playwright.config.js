import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './tests',
  fullyParallel: true,
  use: {
    browserName: 'chromium',
    headless: true,
    // Optional system Chromium; otherwise use `npx playwright install chromium`.
    launchOptions: process.env.DSH_TEST_BROWSER ? { executablePath: process.env.DSH_TEST_BROWSER } : {},
    viewport: { width: 900, height: 900 },
  },
})
