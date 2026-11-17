import { session, type Session, type WebContents } from 'electron';
import type { ShortcutOverrides, WindowCommand } from '../shared/shortcuts.ts';
import type { SettingDefinition } from '../domain/settings/setting.ts';
import type { SettingsService } from '../domain/settings/settings-service.ts';
import type { DataClient } from '../platform/electron/data-service-client.ts';
import type { WindowManager } from '../platform/electron/browser-window.ts';
import type { IpcRouter } from '../platform/electron/ipc-router.ts';
import type { Bookmarks } from './bookmarks.ts';
import { connectBookmarksPage } from './bookmarks-page.ts';
import { connectBrowserImport } from './browser-import.ts';
import { connectDefaultBrowser } from './default-browser.ts';
import { connectHistoryPage } from './history-page.ts';
import { connectSettingsPage } from './settings-page.ts';
import { connectSetupGuide } from './setup-guide.ts';
import { WorkspacesSetting } from './core-settings.ts';
import { workspacePartition } from '../shared/workspaces.ts';

/** What the browser's own pages need from the browser process. */
export interface PageDependencies {
  readonly router: IpcRouter;
  readonly settings: SettingsService;
  /** All settings; those with `ui` metadata appear on the settings page. */
  readonly definitions: readonly SettingDefinition<unknown>[];
  /** Session of the browser's own views, whose pages receive changes. */
  readonly internal: Session;
  readonly data: DataClient;
  readonly bookmarks: Bookmarks;
  readonly windows: WindowManager;
  /** Whether a policy allows the import from other browsers. */
  readonly importAllowed: () => boolean;
  /** Whether a policy lets the user make the browser the default. */
  readonly defaultBrowserAllowed: () => boolean;
  /** Whether this installation can become the default browser. */
  readonly canBeDefaultBrowser: boolean;
  /** The values, as JSON, that the settings which need a restart had when the browser started. */
  readonly startValues: ReadonlyMap<string, string>;
  /** The partition of the web pages of regular windows that no workspace keeps apart. */
  readonly webPartition: string;
  /**
   * Forgets the back and forward history of the tabs, of the session and of its backup, as
   * when the whole history is cleared.
   */
  readonly forgetTabHistories: () => Promise<void>;
  /** The folder in the profile of the background image of the new tab page. */
  readonly newTabFolder: string;
  /** The shortcuts of the windows, and a way to wait for a key press of a page. */
  readonly shortcuts: {
    /** The shortcuts of the windows, by key press. */
    readonly table: () => ReadonlyMap<string, WindowCommand>;
    /** The shortcuts that people chose, by command. */
    readonly overrides: () => ShortcutOverrides;
    /** Waits for the next key press of a page, as a shortcut. */
    readonly record: (contents: WebContents) => Promise<string | undefined>;
  };
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
    dependencies.startValues,
    {
      data,
      // Clearing browsing data clears every workspace: the shared partition, and each one that
      // a workspace keeps apart, also when no page of it loaded in this run.
      web: () =>
        [
          ...new Set([
            dependencies.webPartition,
            ...dependencies.settings
              .get(WorkspacesSetting)
              .map(({ id }) =>
                workspacePartition(
                  dependencies.settings.get(WorkspacesSetting),
                  id,
                  dependencies.webPartition,
                ),
              ),
          ]),
        ].map((partition) => session.fromPartition(partition)),
      forgetTabHistories: dependencies.forgetTabHistories,
    },
    dependencies.shortcuts,
    dependencies.newTabFolder,
  );
  connectHistoryPage(router, data, windows, dependencies.forgetTabHistories);
  connectBookmarksPage(router, data, bookmarks, windows);
  connectBrowserImport(router, data, bookmarks, windows, dependencies.importAllowed);
  connectDefaultBrowser(
    router,
    dependencies.defaultBrowserAllowed,
    dependencies.canBeDefaultBrowser,
  );
  connectSetupGuide(router, windows);
}
