import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 60_000,
  // Flaky tests are fixed, not retried.
  retries: 0,
  workers: 1,
  reporter: process.env['CI'] === undefined ? 'list' : [['list'], ['github']],
  use: { trace: 'retain-on-failure' },
  projects: [
    { name: 'e2e', testIgnore: 'system-picker.spec.ts' },
    // Tests that leave system UI open run last: every browser started after them runs behind it.
    { name: 'system-ui', testMatch: 'system-picker.spec.ts', dependencies: ['e2e'] },
  ],
});
