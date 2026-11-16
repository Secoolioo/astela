import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 60_000,
  // On the runners of CI, the first request of a new web page can leave seconds after its
  // navigation starts (4.8 s on Windows), so an expectation waits longer there than locally.
  expect: { timeout: process.env['CI'] === undefined ? 5_000 : 15_000 },
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
