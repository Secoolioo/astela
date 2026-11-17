import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { defineConfig } from 'vitest/config';

const brand: unknown = JSON.parse(
  readFileSync(resolve(import.meta.dirname, '../brand.json'), 'utf8'),
);

export default defineConfig({
  define: {
    BUILD_BRAND: JSON.stringify(brand),
    BUILD_UPDATE_KEYS: '[]',
    BUILD_TEST_BOOT_FAILURE: 'false',
  },
  test: {
    include: ['src/**/__tests__/**/*.test.ts'],
    environment: 'node',
    restoreMocks: true,
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: [
        'src/**/__tests__/**',
        // Electron-bound code: covered by the end-to-end tests against the packaged app.
        'src/main/**',
        'src/preload/**',
        'src/ui/shell/**',
        'src/ui/newtab/**',
        'src/ui/settings/**',
        'src/ui/setup/**',
        'src/ui/history/**',
        'src/ui/bookmarks/**',
        'src/ui/ui-kit/browser-import.ts',
        'src/ui/ui-kit/default-browser.ts',
        // The elements of the menus, of the star's popover, of the command palette, of the
        // popover of a group of tabs and of the list of the workspaces in the overlay, and
        // their motion, which the end-to-end tests drive; their keys, places and results are
        // tested here.
        'src/ui/overlay/overlay-menu.ts',
        'src/ui/overlay/overlay-bookmark.ts',
        'src/ui/overlay/command-palette.ts',
        'src/ui/overlay/group-popover.ts',
        'src/ui/overlay/workspace-list.ts',
        'src/ui/overlay/popover-motion.ts',
        'src/platform/electron/default-browser.ts',
        'src/main/data-service.ts',
        'src/platform/electron/data-service-client.ts',
        'src/platform/electron/app-protocol.ts',
        'src/platform/electron/browser-window.ts',
        // What browser-window.ts loads later: its code for web pages and the window commands.
        'src/platform/electron/web-pages.ts',
        'src/platform/electron/window-commands.ts',
        'src/platform/electron/ipc-router.ts',
        'src/platform/electron/session-security.ts',
        'src/platform/updates/electron-updater-engine.ts',
        'src/platform/updates/net-feed-fetcher.ts',
      ],
      reporter: ['text-summary', 'json-summary'],
      thresholds: {
        lines: 80,
        branches: 80,
        functions: 80,
        statements: 80,
        'src/kernel/**': { lines: 90, branches: 90, functions: 90, statements: 90 },
        'src/domain/**': { lines: 90, branches: 90, functions: 90, statements: 90 },
      },
    },
  },
});
