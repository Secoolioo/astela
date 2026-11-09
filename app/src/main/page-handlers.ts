import type { Session } from 'electron';
import type { SettingDefinition } from '../domain/settings/setting.ts';
import type { SettingsService } from '../domain/settings/settings-service.ts';
import type { DataServiceClient } from '../platform/electron/data-service-client.ts';
import type { WindowManager } from '../platform/electron/browser-window.ts';
import type { IpcRouter } from '../platform/electron/ipc-router.ts';
import type { Bookmarks } from './bookmarks.ts';
import { connectBookmarksPage } from './bookmarks-page.ts';
import { connectBrowserImport } from './browser-import.ts';
import { connectDefaultBrowser } from './default-browser.ts';
import { connectHistoryPage } from './history-page.ts';
import { connectSettingsPage } from './settings-page.ts';
import { connectSetupGuide } from './setup-guide.ts';

/** What the browser's own pages need from the browser process. */
export interface PageDependencies {
  readonly router: IpcRouter;
  readonly settings: SettingsService;
  /** All settings; those with `ui` metadata appear on the settings page. */
  readonly definitions: readonly SettingDefinition<unknown>[];
  /** Session of the browser's own views, whose pages receive changes. */
  readonly internal: Session;
  readonly data: DataServiceClient;
  readonly bookmarks: Bookmarks;
  readonly windows: WindowManager;
  /** Whether a policy allows the import from other browsers. */
  readonly importAllowed: () => boolean;
  /** Whether a policy lets the user make the browser the default. */
  readonly defaultBrowserAllowed: () => boolean;
  /** Whether this installation can become the default browser. */
  readonly canBeDefaultBrowser: boolean;
}

/**
 * Connects the browser's own pages other than the new tab page: settings, setup guide,
 * history, bookmarks, the import and the default browser setting. The browser loads this
 * module with the first of these pages, before the page itself, so the start does not.
 * @param dependencies - What the pages need.
 */
export function connectPages(dependencies: PageDependencies): void {
  const { router, data, bookmarks, windows } = dependencies;
  connectSettingsPage(
    router,
    dependencies.settings,
    dependencies.definitions,
    dependencies.internal,
  );
  connectHistoryPage(router, data, windows);
  connectBookmarksPage(router, data, bookmarks, windows);
  connectBrowserImport(router, data, bookmarks, windows, dependencies.importAllowed);
  connectDefaultBrowser(
    router,
    dependencies.defaultBrowserAllowed,
    dependencies.canBeDefaultBrowser,
  );
  connectSetupGuide(router, windows);
}
