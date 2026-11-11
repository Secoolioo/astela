import { CustomThemeSetting, NewTabBackgroundSetting, ThemeSetting } from './core-settings.ts';
import { app, webContents, type Session, type WebContents } from 'electron';
import { accentColors, accentPresets } from '../domain/appearance/accent.ts';
import { restartArguments } from '../domain/navigation/restart.ts';
import type { SettingDefinition } from '../domain/settings/setting.ts';
import type { SettingsService } from '../domain/settings/settings-service.ts';
import type { Disposable } from '../shared/disposable.ts';
import {
  ChooseDownloadFolder,
  ClearBrowsingData,
  GetShortcuts,
  RecordShortcut,
  ChooseNewTabImage,
  ExportTheme,
  ImportTheme,
  ShortcutRecorded,
  ExportSettings,
  GetSettings,
  ImportSettings,
  ResetSettings,
  RestartBrowser,
  SetSetting,
  SettingsChanged,
  type SettingView,
} from '../shared/ipc/settings-contracts.ts';
import type { DataClient } from '../platform/electron/data-service-client.ts';
import {
  shortcutProblem,
  shortcutsOf,
  windowCommands,
  type ShortcutOverrides,
  type WindowCommand,
} from '../shared/shortcuts.ts';
import type { IpcRouter } from '../platform/electron/ipc-router.ts';

/**
 * Whether a request comes from the settings page itself. The setup guide may use the settings
 * too, but only the settings page resets, exports and imports them.
 * @param sender - The page that sent the request.
 */
function fromSettingsPage(sender: WebContents): boolean {
  try {
    return new URL(sender.getURL()).host === 'settings';
  } catch {
    return false;
  }
}

/**
 * Connects the settings page to the settings: it reads and writes every setting that has a
 * place on the page, and hears about every change, wherever it came from.
 * @param router - IPC router.
 * @param settings - Loaded settings.
 * @param definitions - All settings; those with `ui` metadata appear on the page.
 * @param internal - Session of the browser's own views, whose pages receive changes.
 * @param startValues - The values, as JSON, that the settings which need a restart had when
 *   the browser started.
 * @param browsingData - The data service and the session of web pages, whose data the page
 *   clears.
 * @param shortcuts - The shortcuts of the windows, and a way to wait for a key press of a page.
 * @param newTabFolder - The folder in the profile of the background image of the new tab page.
 * @returns A disposable that stops publishing changes.
 */
export function connectSettingsPage(
  router: IpcRouter,
  settings: SettingsService,
  definitions: readonly SettingDefinition<unknown>[],
  internal: Session,
  startValues: ReadonlyMap<string, string>,
  browsingData: { readonly data: Pick<DataClient, 'call'>; readonly web: () => Session },
  shortcuts: {
    readonly table: () => ReadonlyMap<string, WindowCommand>;
    readonly overrides: () => ShortcutOverrides;
    readonly record: (contents: WebContents) => Promise<string | undefined>;
  },
  newTabFolder: string,
): Disposable {
  const shown = new Map(
    definitions.filter((definition) => definition.ui !== undefined).map((d) => [d.key, d]),
  );
  const view = (definition: SettingDefinition<unknown>): SettingView => {
    const inspection = settings.inspect(definition);
    const { value, locked } = inspection;
    return {
      key: definition.key,
      value,
      locked,
      changed:
        !locked &&
        inspection.userValue !== undefined &&
        JSON.stringify(inspection.userValue) !== JSON.stringify(definition.default),
      recommended: inspection.source === 'policy-recommended',
      restart:
        definition.restartRequired === true &&
        startValues.get(definition.key) !== JSON.stringify(value),
    };
  };
  router.handle(GetSettings, () => ({
    settings: [...shown.values()].map(view),
    accents: accentPresets.map((id) => {
      const { light, dark } = accentColors(id);
      return { id, light, dark };
    }),
  }));
  router.handle(SetSetting, ({ key, value }) => {
    const definition = shown.get(key);
    if (definition === undefined) {
      return { ok: false, error: 'unknown' } as const;
    }
    // Only the system's dialog sets a folder.
    if (definition.ui?.control === 'folder') return { ok: false, error: 'invalid' } as const;
    const result = settings.set(definition, value);
    if (result.ok) {
      return { ok: true } as const;
    }
    return {
      ok: false,
      error: result.error.kind === 'locked-by-policy' ? 'locked' : 'invalid',
    } as const;
  });
  router.handle(ResetSettings, ({ keys }, { sender }) => {
    if (!fromSettingsPage(sender)) throw new Error('Only the settings page resets settings');
    for (const key of keys) {
      const definition = shown.get(key);
      if (definition !== undefined && !settings.inspect(definition).locked) {
        settings.reset(definition);
      }
    }
    return null;
  });
  router.handle(ExportSettings, async (_request, { sender }) => {
    if (!fromSettingsPage(sender)) throw new Error('Only the settings page exports settings');
    const { exportSettings } = await import('./settings-file.ts');
    return { saved: await exportSettings(sender, [...shown.values()], settings) };
  });
  router.handle(ImportSettings, async (_request, { sender }) => {
    if (!fromSettingsPage(sender)) throw new Error('Only the settings page imports settings');
    const { importSettings } = await import('./settings-file.ts');
    return importSettings(sender, shown, settings);
  });
  router.handle(ChooseDownloadFolder, async (_request, { sender }) => {
    if (!fromSettingsPage(sender)) throw new Error('Only the settings page chooses folders');
    const definition = shown.get('downloads.folder');
    if (definition === undefined || settings.inspect(definition).locked) return { chosen: false };
    const current = settings.get(definition);
    const { chooseFolder } = await import('./settings-file.ts');
    const folder = await chooseFolder(
      sender,
      typeof current === 'string' && current !== '' ? current : app.getPath('downloads'),
    );
    return { chosen: folder !== undefined && settings.set(definition, folder).ok };
  });
  router.handle(GetShortcuts, (_request, { sender }) => {
    if (!fromSettingsPage(sender)) throw new Error('Only the settings page reads the shortcuts');
    const table = shortcuts.table();
    const overrides = shortcuts.overrides();
    return {
      mac: process.platform === 'darwin',
      commands: windowCommands.map((command) => ({
        command,
        shortcuts: shortcutsOf(table, command),
        changed: overrides[command] !== undefined,
      })),
    };
  });
  router.handle(RecordShortcut, (_request, { sender }) => {
    if (!fromSettingsPage(sender)) throw new Error('Only the settings page records shortcuts');
    // The answer tells the page that the browser waits; the key press follows as an event.
    void shortcuts.record(sender).then((shortcut) => {
      if (sender.isDestroyed()) return;
      router.publish(ShortcutRecorded, sender, {
        shortcut: shortcut ?? null,
        problem:
          shortcut === undefined ? null : (shortcutProblem(shortcut, process.platform) ?? null),
      });
    });
    return null;
  });
  router.handle(ExportTheme, async (_request, { sender }) => {
    if (!fromSettingsPage(sender)) throw new Error('Only the settings page exports themes');
    const { exportTheme } = await import('./settings-file.ts');
    const theme = settings.get(CustomThemeSetting);
    return { saved: await exportTheme(sender, theme) };
  });
  router.handle(ImportTheme, async (_request, { sender }) => {
    if (!fromSettingsPage(sender)) throw new Error('Only the settings page imports themes');
    const { importTheme } = await import('./settings-file.ts');
    const result = await importTheme(sender);
    if (!result.ok) return { ok: false, error: result.error };
    const saved =
      settings.set(CustomThemeSetting, result.theme).ok && settings.set(ThemeSetting, 'custom').ok;
    return saved ? { ok: true } : { ok: false, error: 'invalid' as const };
  });
  router.handle(ChooseNewTabImage, async (_request, { sender }) => {
    if (!fromSettingsPage(sender)) throw new Error('Only the settings page chooses images');
    const { chooseNewTabImage } = await import('./settings-file.ts');
    const image = await chooseNewTabImage(sender, newTabFolder);
    if (image === 'invalid') return { chosen: false, error: 'invalid' as const };
    if (image === undefined) return { chosen: false };
    return {
      chosen: settings.set(NewTabBackgroundSetting, { kind: 'image', file: image.file }).ok,
    };
  });
  router.handle(ClearBrowsingData, async (request, { sender }) => {
    if (!fromSettingsPage(sender)) throw new Error('Only the settings page clears data');
    const { clearBrowsingData } = await import('./clear-data.ts');
    await clearBrowsingData(request, browsingData.data, browsingData.web(), Date.now());
    return null;
  });
  router.handle(RestartBrowser, (_request, { sender }) => {
    if (!fromSettingsPage(sender)) throw new Error('Only the settings page restarts the browser');
    app.relaunch({ args: restartArguments(process.argv.slice(1), process.defaultApp) });
    // Quitting saves the session and the settings first, as on every quit.
    app.quit();
    return null;
  });
  return settings.onDidChange(({ keys }) => {
    const changed = keys.flatMap((key) => {
      const definition = shown.get(key);
      return definition === undefined ? [] : [view(definition)];
    });
    if (changed.length === 0) {
      return;
    }
    for (const contents of webContents.getAllWebContents()) {
      if (contents.session === internal) {
        router.publish(SettingsChanged, contents, { settings: changed });
      }
    }
  });
}
