import { BaseWindow, app, dialog, type WebContents } from 'electron';
import { readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import type { SettingDefinition } from '../domain/settings/setting.ts';
import type { SettingsService } from '../domain/settings/settings-service.ts';
import { brand } from '../shared/brand.ts';
import { writeFileAtomic } from '../platform/node/atomic-file.ts';
import { translatorFor } from './i18n/i18n.ts';

/** The version of the format of settings files; a later format gets a new number. */
const fileVersion = 1;

/** The largest settings file that the browser reads: lists of sites can be long. */
const largestFile = 16 * 1024 * 1024;

/** The window of a page, for its dialogs. */
function windowOf(contents: WebContents): BaseWindow | undefined {
  return BaseWindow.getAllWindows().find((window) =>
    window.contentView.children.some(
      (view) => 'webContents' in view && view.webContents === contents,
    ),
  );
}

/** The options of the file dialogs of settings files. */
function fileOptions(title: string): Electron.SaveDialogOptions & Electron.OpenDialogOptions {
  const i18n = translatorFor(app.getLocale(), process.platform);
  return {
    title,
    defaultPath: join(app.getPath('documents'), `${brand.slug}-settings.json`),
    filters: [{ name: i18n.t('settings.fileType'), extensions: ['json'] }],
  };
}

/**
 * Saves the settings that the user changed, in a file that the user picks.
 * @param sender - The settings page.
 * @param definitions - The settings that the page shows.
 * @param settings - The settings.
 * @returns Whether the file was saved.
 */
export async function exportSettings(
  sender: WebContents,
  definitions: readonly SettingDefinition<unknown>[],
  settings: SettingsService,
): Promise<boolean> {
  const i18n = translatorFor(app.getLocale(), process.platform);
  const options = fileOptions(i18n.t('settings.exportTitle'));
  const window = windowOf(sender);
  const { canceled, filePath } =
    window === undefined
      ? await dialog.showSaveDialog(options)
      : await dialog.showSaveDialog(window, options);
  if (canceled || filePath === undefined || filePath === '') return false;
  const values: Record<string, unknown> = {};
  for (const definition of definitions) {
    const { userValue } = settings.inspect(definition);
    if (userValue !== undefined) values[definition.key] = userValue;
  }
  const file = { $schemaVersion: fileVersion, settings: values };
  await writeFileAtomic(filePath, `${JSON.stringify(file, null, 2)}\n`);
  return true;
}

/**
 * Reads settings from a file that the user picks. Settings that a policy fixes, that the page
 * does not show or whose value is not valid are skipped; nothing else changes.
 * @param sender - The settings page.
 * @param shown - The settings that the page shows, by key.
 * @param settings - The settings.
 */
export async function importSettings(
  sender: WebContents,
  shown: ReadonlyMap<string, SettingDefinition<unknown>>,
  settings: SettingsService,
): Promise<
  | { readonly ok: true; readonly applied: number; readonly skipped: number }
  | { readonly ok: false; readonly error: 'canceled' | 'invalid' }
> {
  const i18n = translatorFor(app.getLocale(), process.platform);
  const options = {
    ...fileOptions(i18n.t('settings.importTitle')),
    properties: ['openFile' as const],
  };
  const window = windowOf(sender);
  const { canceled, filePaths } =
    window === undefined
      ? await dialog.showOpenDialog(options)
      : await dialog.showOpenDialog(window, options);
  const path = filePaths[0];
  if (canceled || path === undefined) return { ok: false, error: 'canceled' };
  let parsed: unknown;
  try {
    if ((await stat(path)).size > largestFile) return { ok: false, error: 'invalid' };
    parsed = JSON.parse(await readFile(path, 'utf8'));
  } catch {
    return { ok: false, error: 'invalid' };
  }
  const values: unknown =
    typeof parsed === 'object' &&
    parsed !== null &&
    Reflect.get(parsed, '$schemaVersion') === fileVersion
      ? Reflect.get(parsed, 'settings')
      : undefined;
  if (typeof values !== 'object' || values === null || Array.isArray(values)) {
    return { ok: false, error: 'invalid' };
  }
  let applied = 0;
  let skipped = 0;
  for (const [key, value] of Object.entries(values)) {
    const definition = shown.get(key);
    if (definition !== undefined && settings.set(definition, value).ok) applied += 1;
    else skipped += 1;
  }
  return { ok: true, applied, skipped };
}
