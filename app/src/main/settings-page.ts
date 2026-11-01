import { webContents, type Session } from 'electron';
import { accentColors, accentPresets } from '../domain/appearance/accent.ts';
import type { SettingDefinition } from '../domain/settings/setting.ts';
import type { SettingsService } from '../domain/settings/settings-service.ts';
import type { Disposable } from '../shared/disposable.ts';
import {
  GetSettings,
  SetSetting,
  SettingsChanged,
  type SettingView,
} from '../shared/ipc/settings-contracts.ts';
import type { IpcRouter } from '../platform/electron/ipc-router.ts';

/**
 * Connects the settings page to the settings: it reads and writes every setting that has a
 * place on the page, and hears about every change, wherever it came from.
 * @param router - IPC router.
 * @param settings - Loaded settings.
 * @param definitions - All settings; those with `ui` metadata appear on the page.
 * @param internal - Session of the browser's own views, whose pages receive changes.
 * @returns A disposable that stops publishing changes.
 */
export function connectSettingsPage(
  router: IpcRouter,
  settings: SettingsService,
  definitions: readonly SettingDefinition<unknown>[],
  internal: Session,
): Disposable {
  const shown = new Map(
    definitions.filter((definition) => definition.ui !== undefined).map((d) => [d.key, d]),
  );
  const view = (definition: SettingDefinition<unknown>): SettingView => {
    const { value, locked } = settings.inspect(definition);
    return { key: definition.key, value, locked };
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
