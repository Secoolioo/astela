import { app, webContents, type Session, type WebContents } from 'electron';
import { accentColors, accentPresets } from '../domain/appearance/accent.ts';
import { restartArguments } from '../domain/navigation/restart.ts';
import type { SettingDefinition } from '../domain/settings/setting.ts';
import type { SettingsService } from '../domain/settings/settings-service.ts';
import type { Disposable } from '../shared/disposable.ts';
import {
  ExportSettings,
  GetSettings,
  ImportSettings,
  ResetSettings,
  RestartBrowser,
  SetSetting,
  SettingsChanged,
  type SettingView,
} from '../shared/ipc/settings-contracts.ts';
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
 * @returns A disposable that stops publishing changes.
 */
export function connectSettingsPage(
  router: IpcRouter,
  settings: SettingsService,
  definitions: readonly SettingDefinition<unknown>[],
  internal: Session,
  startValues: ReadonlyMap<string, string>,
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
